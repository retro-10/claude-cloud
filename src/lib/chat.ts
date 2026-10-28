import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { chatChannels, chatMembers, chatMessages, notifications, users } from "@/db/schema";
import { audit } from "./audit";
import type { Fail } from "./result";

// Team chat between staff: channels everyone can browse and join, and direct messages between two or more people.
// The open conversation polls for changes (see /chat/[id]/updates), so there is no socket server to run.

export const MAX_BODY = 4000;
export const MAX_DM_PEOPLE = 9;
const PAGE = 50;

type Me = { id: number; isOwner: boolean };
type ChannelRow = typeof chatChannels.$inferSelect;
export type ChatPerson = { id: number; name: string };

export type Conversation = {
  id: number;
  kind: "channel" | "dm";
  title: string; // "general" or the other people's names
  topic: string | null;
  everyone: boolean;
  people: ChatPerson[]; // a DM's members, me included
  unread: number;
  lastAt: Date | null;
};

export type ChatMessage = {
  id: number;
  userId: number;
  author: string;
  body: string; // empty once deleted
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
};

export const chatLink = (channelId: number) => `/chat/${channelId}`;

/** "Product launch" -> "product-launch": lowercase letters (any script), digits and single dashes. */
export function channelName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Who a message @mentions: a person's first name or their full name with the spaces left out (@Mona, @MonaAli). */
export function mentionedIds(body: string, people: ChatPerson[]): number[] {
  return people
    .filter((p) => {
      const first = p.name.trim().split(/\s+/)[0];
      const full = p.name.replace(/\s+/g, "");
      return [first, full].some((n) => n && new RegExp(`(^|[^\\p{L}\\p{N}_])@${escapeRe(n)}(?![\\p{L}\\p{N}_])`, "iu").test(body));
    })
    .map((p) => p.id);
}

// ---------------- access ----------------

async function channel(db: Db, id: number): Promise<ChannelRow | null> {
  const [c] = await db.select().from(chatChannels).where(eq(chatChannels.id, id));
  return c ?? null;
}

async function isMember(db: Db, channelId: number, userId: number) {
  const [m] = await db.select({ u: chatMembers.userId }).from(chatMembers).where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));
  return !!m;
}

/** The conversation if I may read it: a channel is open to every staff member, a DM only to the people in it. */
async function readable(db: Db, id: number, userId: number): Promise<ChannelRow | null> {
  const c = await channel(db, id);
  return c && (c.kind === "channel" || (await isMember(db, c.id, userId))) ? c : null;
}

async function peopleOf(db: Db, channelIds: number[]): Promise<Map<number, ChatPerson[]>> {
  const out = new Map<number, ChatPerson[]>();
  if (!channelIds.length) return out;
  const rows = await db
    .select({ channelId: chatMembers.channelId, id: users.id, name: users.name })
    .from(chatMembers)
    .innerJoin(users, eq(users.id, chatMembers.userId))
    .where(inArray(chatMembers.channelId, channelIds))
    .orderBy(asc(users.name));
  for (const r of rows) {
    if (!out.has(r.channelId)) out.set(r.channelId, []);
    out.get(r.channelId)!.push({ id: r.id, name: r.name });
  }
  return out;
}

const dmTitle = (people: ChatPerson[], me: number) =>
  people
    .filter((p) => p.id !== me)
    .map((p) => p.name)
    .join(", ") || "Just you";

// ---------------- the conversation list ----------------

/**
 * My conversations: channels I joined (and the "everyone" ones), my DMs, each with what I have not read yet, and
 * the open channels I could join. Messages from before I had an account never count as unread.
 */
export async function listConversations(db: Db, me: number) {
  const unread = sql<number>`(select count(*) from ${chatMessages} x where x.channel_id = ${chatChannels.id}
    and x.id > coalesce(${chatMembers.lastReadId}, 0) and x.user_id <> ${me} and x.deleted_at is null
    and x.created_at > (select created_at from ${users} where id = ${me}))::int`;
  const lastAt = sql<Date | null>`(select max(x.created_at) from ${chatMessages} x where x.channel_id = ${chatChannels.id} and x.deleted_at is null)`;
  const rows = await db
    .select({ c: chatChannels, joined: sql<boolean>`${chatMembers.userId} is not null`, unread, lastAt })
    .from(chatChannels)
    .leftJoin(chatMembers, and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, me)))
    .where(isNull(chatChannels.archivedAt))
    .orderBy(asc(chatChannels.name), asc(chatChannels.id));
  const mine = rows.filter((r) => r.c.everyone || r.joined);
  const people = await peopleOf(db, mine.filter((r) => r.c.kind === "dm").map((r) => r.c.id));
  const conv = (r: (typeof rows)[number]): Conversation => {
    const ppl = people.get(r.c.id) ?? [];
    return {
      id: r.c.id,
      kind: r.c.kind as Conversation["kind"],
      title: r.c.kind === "dm" ? dmTitle(ppl, me) : r.c.name!,
      topic: r.c.topic,
      everyone: r.c.everyone,
      people: ppl,
      unread: r.unread,
      lastAt: r.lastAt ? new Date(r.lastAt) : null,
    };
  };
  const byRecent = (a: Conversation, b: Conversation) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0);
  return {
    channels: mine.filter((r) => r.c.kind === "channel").map(conv),
    dms: mine.filter((r) => r.c.kind === "dm").map(conv).sort(byRecent),
    browse: rows.filter((r) => r.c.kind === "channel" && !r.c.everyone && !r.joined).map((r) => ({ id: r.c.id, name: r.c.name!, topic: r.c.topic })),
  };
}

/** For the sidebar badge: unread messages across all my conversations. */
export async function unreadTotal(db: Db, me: number): Promise<number> {
  const { channels, dms } = await listConversations(db, me);
  return [...channels, ...dms].reduce((n, c) => n + c.unread, 0);
}

/** One conversation as I see it, or null when it does not exist or is not mine to read. */
export async function getConversation(db: Db, me: number, id: number) {
  const c = await readable(db, id, me);
  if (!c) return null;
  const people = (await peopleOf(db, [c.id])).get(c.id) ?? [];
  const [mine] = await db.select({ lastReadId: chatMembers.lastReadId }).from(chatMembers).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, me)));
  return {
    id: c.id,
    kind: c.kind as Conversation["kind"],
    title: c.kind === "dm" ? dmTitle(people, me) : c.name!,
    name: c.name,
    topic: c.topic,
    everyone: c.everyone,
    archived: !!c.archivedAt,
    createdBy: c.createdBy,
    people,
    joined: c.everyone || people.some((p) => p.id === me),
    lastReadId: mine?.lastReadId ?? 0,
  };
}

// ---------------- messages ----------------

const messageCols = {
  id: chatMessages.id,
  userId: chatMessages.userId,
  author: users.name,
  body: chatMessages.body,
  createdAt: chatMessages.createdAt,
  editedAt: chatMessages.editedAt,
  deletedAt: chatMessages.deletedAt,
};
const toMessage = (r: { id: number; userId: number; author: string; body: string; createdAt: Date; editedAt: Date | null; deletedAt: Date | null }): ChatMessage => ({
  id: r.id,
  userId: r.userId,
  author: r.author,
  body: r.deletedAt ? "" : r.body,
  createdAt: r.createdAt,
  editedAt: r.editedAt,
  deleted: !!r.deletedAt,
});

/** The latest messages, or the ones before `before` (scrolling back), oldest first. */
export async function listMessages(db: Db, me: number, channelId: number, opts: { before?: number; limit?: number } = {}): Promise<ChatMessage[] | null> {
  if (!(await readable(db, channelId, me))) return null;
  const rows = await db
    .select(messageCols)
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.channelId, channelId), opts.before ? lt(chatMessages.id, opts.before) : undefined))
    .orderBy(desc(chatMessages.id))
    .limit(Math.min(opts.limit ?? PAGE, 200));
  return rows.reverse().map(toMessage);
}

/** Messages added, edited or deleted since a moment: what the open conversation polls for. */
export async function changedSince(db: Db, me: number, channelId: number, since: Date): Promise<ChatMessage[] | null> {
  if (!(await readable(db, channelId, me))) return null;
  const rows = await db
    .select(messageCols)
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.channelId, channelId), gte(chatMessages.updatedAt, since)))
    .orderBy(asc(chatMessages.id))
    .limit(500);
  return rows.map(toMessage);
}

/** I have seen everything up to `upTo`: the unread count drops, and chat notifications for it are cleared. */
export async function markRead(db: Db, me: number, channelId: number, upTo: number) {
  const c = await readable(db, channelId, me);
  if (!c) return;
  // a channel I only browse keeps no read position; the everyone channels and my DMs do
  if (c.kind === "channel" && !c.everyone && !(await isMember(db, channelId, me))) return;
  await db
    .insert(chatMembers)
    .values({ channelId, userId: me, lastReadId: upTo })
    .onConflictDoUpdate({ target: [chatMembers.channelId, chatMembers.userId], set: { lastReadId: sql`greatest(${chatMembers.lastReadId}, ${upTo})` } });
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me), eq(notifications.link, chatLink(channelId)), isNull(notifications.readAt)));
}

function cleanBody(raw: string): string | Fail {
  const body = raw.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!body) return { ok: false, error: "Write a message first" };
  if (body.length > MAX_BODY) return { ok: false, error: `Messages can be up to ${MAX_BODY} characters` };
  return body;
}

/**
 * Sends a message. Posting in a channel joins it. People @mentioned get a notification; in a DM the others get one
 * "new message" notification until they open it (not one per message).
 */
export async function postMessage(db: Db, me: { id: number; name: string }, channelId: number, raw: string): Promise<{ ok: true; id: number } | Fail> {
  const c = await readable(db, channelId, me.id);
  if (!c) return { ok: false, error: "That conversation does not exist" };
  if (c.archivedAt) return { ok: false, error: "This channel is archived" };
  const body = cleanBody(raw);
  if (typeof body !== "string") return body;
  const [row] = await db.insert(chatMessages).values({ channelId, userId: me.id, body }).returning({ id: chatMessages.id });
  if (c.kind === "channel" && !c.everyone) await db.insert(chatMembers).values({ channelId, userId: me.id }).onConflictDoNothing();
  await markRead(db, me.id, channelId, row.id);

  const where = c.kind === "dm" ? "a direct message" : `#${c.name}`;
  const link = chatLink(channelId);
  // who may be told: active staff who can read this conversation, never the sender
  const audience =
    c.kind === "dm"
      ? ((await peopleOf(db, [channelId])).get(channelId) ?? [])
      : await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true));
  const others = audience.filter((p) => p.id !== me.id);
  const activeIds = new Set((await db.select({ id: users.id }).from(users).where(eq(users.active, true))).map((u) => u.id));
  const mentioned = new Set(mentionedIds(body, others).filter((id) => activeIds.has(id)));
  const notes = [...mentioned].map((userId) => ({ userId, kind: "chat_mention", title: `${me.name} mentioned you in ${where}`, link }));
  if (c.kind === "dm") {
    const waiting = new Set(
      (
        await db
          .select({ u: notifications.userId })
          .from(notifications)
          .where(and(eq(notifications.link, link), isNull(notifications.readAt)))
      ).map((r) => r.u),
    );
    for (const p of others) {
      if (mentioned.has(p.id) || waiting.has(p.id) || !activeIds.has(p.id)) continue;
      notes.push({ userId: p.id, kind: "chat_dm", title: `New message from ${me.name}`, link });
    }
  }
  if (notes.length) await db.insert(notifications).values(notes);
  return { ok: true, id: row.id };
}

async function ownMessage(db: Db, me: Me, id: number, allowOwner: boolean) {
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.deletedAt) return { ok: false as const, error: "That message is gone" };
  if (m.userId !== me.id && !(allowOwner && me.isOwner)) return { ok: false as const, error: "You can change only your own messages" };
  if (!(await readable(db, m.channelId, me.id))) return { ok: false as const, error: "That message is gone" };
  return { ok: true as const, m };
}

export async function editMessage(db: Db, me: Me, id: number, raw: string): Promise<{ ok: true } | Fail> {
  const r = await ownMessage(db, me, id, false);
  if (!r.ok) return r;
  const body = cleanBody(raw);
  if (typeof body !== "string") return body;
  if (body === r.m.body) return { ok: true };
  await db.update(chatMessages).set({ body, editedAt: new Date(), updatedAt: new Date() }).where(eq(chatMessages.id, id));
  return { ok: true };
}

/** Your own messages; an owner can also remove anyone's (that is audited). The text is wiped, a stub stays. */
export async function deleteMessage(db: Db, me: Me, id: number): Promise<{ ok: true } | Fail> {
  const r = await ownMessage(db, me, id, true);
  if (!r.ok) return r;
  await db.update(chatMessages).set({ body: "", deletedAt: new Date(), updatedAt: new Date() }).where(eq(chatMessages.id, id));
  if (r.m.userId !== me.id) await audit(db, { userId: me.id, entity: "chat_message", entityId: id, action: "delete", diff: { channelId: r.m.channelId, author: r.m.userId } });
  return { ok: true };
}

// ---------------- channels and DMs ----------------

export async function createChannel(db: Db, me: number, input: { name: string; topic?: string | null }): Promise<{ ok: true; id: number } | Fail> {
  const name = channelName(input.name);
  if (name.length < 2) return { ok: false, error: "Give the channel a name of at least 2 letters" };
  const [taken] = await db.select({ id: chatChannels.id, archivedAt: chatChannels.archivedAt }).from(chatChannels).where(eq(chatChannels.name, name));
  if (taken) return { ok: false, error: taken.archivedAt ? `#${name} exists but is archived` : `#${name} already exists` };
  const [c] = await db
    .insert(chatChannels)
    .values({ kind: "channel", name, topic: input.topic?.trim().slice(0, 200) || null, createdBy: me })
    .returning({ id: chatChannels.id });
  await db.insert(chatMembers).values({ channelId: c.id, userId: me });
  await audit(db, { userId: me, entity: "chat_channel", entityId: c.id, action: "create", diff: { name } });
  return { ok: true, id: c.id };
}

async function manageable(db: Db, me: Me, id: number) {
  const c = await channel(db, id);
  if (!c || c.kind !== "channel") return { ok: false as const, error: "That channel does not exist" };
  if (!me.isOwner && c.createdBy !== me.id) return { ok: false as const, error: "Only the person who created the channel, or an owner, can change it" };
  return { ok: true as const, c };
}

export async function updateChannel(db: Db, me: Me, id: number, input: { name: string; topic?: string | null }): Promise<{ ok: true } | Fail> {
  const r = await manageable(db, me, id);
  if (!r.ok) return r;
  const name = channelName(input.name);
  if (name.length < 2) return { ok: false, error: "Give the channel a name of at least 2 letters" };
  const [taken] = await db.select({ id: chatChannels.id }).from(chatChannels).where(and(eq(chatChannels.name, name), ne(chatChannels.id, id)));
  if (taken) return { ok: false, error: `#${name} already exists` };
  const topic = input.topic?.trim().slice(0, 200) || null;
  await db.update(chatChannels).set({ name, topic }).where(eq(chatChannels.id, id));
  await audit(db, { userId: me.id, entity: "chat_channel", entityId: id, action: "update", diff: { name, topic } });
  return { ok: true };
}

/** Archived channels drop out of the list; their history stays and can be read from a link. */
export async function archiveChannel(db: Db, me: Me, id: number, archived = true): Promise<{ ok: true } | Fail> {
  const r = await manageable(db, me, id);
  if (!r.ok) return r;
  if (r.c.everyone && !me.isOwner) return { ok: false, error: "Only an owner can archive a channel for everyone" };
  await db.update(chatChannels).set({ archivedAt: archived ? new Date() : null }).where(eq(chatChannels.id, id));
  await audit(db, { userId: me.id, entity: "chat_channel", entityId: id, action: archived ? "archive" : "restore" });
  return { ok: true };
}

export async function joinChannel(db: Db, me: number, id: number): Promise<{ ok: true } | Fail> {
  const c = await channel(db, id);
  if (!c || c.kind !== "channel" || c.archivedAt) return { ok: false, error: "That channel does not exist" };
  if (c.everyone) return { ok: true };
  // start reading from now: joining does not make the whole history unread
  const [last] = await db.select({ id: sql<number>`coalesce(max(${chatMessages.id}), 0)::int` }).from(chatMessages).where(eq(chatMessages.channelId, id));
  await db.insert(chatMembers).values({ channelId: id, userId: me, lastReadId: last.id }).onConflictDoNothing();
  return { ok: true };
}

export async function leaveChannel(db: Db, me: number, id: number): Promise<{ ok: true } | Fail> {
  const c = await channel(db, id);
  if (!c || c.kind !== "channel") return { ok: false, error: "That channel does not exist" };
  if (c.everyone) return { ok: false, error: `Everyone is in #${c.name}` };
  await db.delete(chatMembers).where(and(eq(chatMembers.channelId, id), eq(chatMembers.userId, me)));
  return { ok: true };
}

/** The DM with these people (I am added): the same group always reopens the same conversation. */
export async function openDm(db: Db, me: number, withIds: number[]): Promise<{ ok: true; id: number } | Fail> {
  const ids = [...new Set([me, ...withIds])].sort((a, b) => a - b);
  if (ids.length < 2) return { ok: false, error: "Pick at least one person" };
  if (ids.length > MAX_DM_PEOPLE) return { ok: false, error: `A direct message can have up to ${MAX_DM_PEOPLE} people; make a channel instead` };
  const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.active, true)));
  if (found.length !== ids.length) return { ok: false, error: "Someone in that list is not an active user" };
  const dmKey = ids.join(",");
  const [existing] = await db.select({ id: chatChannels.id }).from(chatChannels).where(eq(chatChannels.dmKey, dmKey));
  if (existing) return { ok: true, id: existing.id };
  const [c] = await db.insert(chatChannels).values({ kind: "dm", dmKey, createdBy: me }).onConflictDoNothing().returning({ id: chatChannels.id });
  // two people opening the same DM at once: the other insert won, use it
  const id = c?.id ?? (await db.select({ id: chatChannels.id }).from(chatChannels).where(eq(chatChannels.dmKey, dmKey)))[0].id;
  await db.insert(chatMembers).values(ids.map((userId) => ({ channelId: id, userId }))).onConflictDoNothing();
  return { ok: true, id };
}

/** Everyone I can talk to, for the people picker and @mentions. */
export const chatPeople = (db: Db) =>
  db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name));

