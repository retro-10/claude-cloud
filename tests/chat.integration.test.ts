import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  MAX_BODY,
  archiveChannel,
  changedSince,
  channelName,
  createChannel,
  deleteMessage,
  editMessage,
  getConversation,
  joinChannel,
  leaveChannel,
  listConversations,
  listMessages,
  markRead,
  mentionedIds,
  openDm,
  postMessage,
  unreadTotal,
  updateChannel,
} from "@/lib/chat";
import { createUser } from "@/lib/settings";

describe("chat text rules", () => {
  it("channel names are lowercase words joined by dashes", () => {
    expect(channelName("  Product Launch!! 2027 ")).toBe("product-launch-2027");
    expect(channelName("--sales__team--")).toBe("sales-team");
    expect(channelName("المبيعات")).toBe("المبيعات");
    expect(channelName("x".repeat(60))).toHaveLength(40);
  });

  it("@mentions match a first name or the full name without spaces, not inside words or emails", () => {
    const people = [
      { id: 1, name: "Mona Ali" },
      { id: 2, name: "Omar" },
      { id: 3, name: "Sara Omar" },
    ];
    expect(mentionedIds("@mona can you check?", people)).toEqual([1]);
    expect(mentionedIds("ping @MonaAli and @omar.", people)).toEqual([1, 2]);
    expect(mentionedIds("mail omar@example.com, @omarx", people)).toEqual([]);
    expect(mentionedIds("@Sara", people)).toEqual([3]);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("team chat", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  type P = { id: number; name: string; isOwner: boolean };
  let owner: P, mona: P, omar: P;
  let general: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    // seeded users stay out of the way: only these three are active
    await db.update(s.users).set({ active: false });
    const [o] = await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local"));
    await db.update(s.users).set({ active: true, createdAt: new Date("2026-01-01") }).where(eq(s.users.id, o.id));
    owner = { id: o.id, name: o.name, isOwner: true };
    const m = await createUser(db, { name: "Mona Ali", email: "mona@chat.local", role: "sales", password: "long enough pw" }, null);
    const r = await createUser(db, { name: "Omar", email: "omar@chat.local", role: "designer", password: "long enough pw" }, null);
    if (!m.ok || !r.ok) throw new Error("users");
    mona = { id: m.id, name: "Mona Ali", isOwner: false };
    omar = { id: r.id, name: "Omar", isOwner: false };
    [{ id: general }] = await db.select({ id: s.chatChannels.id }).from(s.chatChannels).where(eq(s.chatChannels.name, "general"));
  });
  afterAll(() => client.end());

  it("#general exists for everyone without joining; messages are read back oldest first", async () => {
    const list = await listConversations(db, mona.id);
    expect(list.channels.map((c) => [c.title, c.everyone])).toEqual([["general", true]]);
    expect(await postMessage(db, owner, general, "  Welcome to HQ chat  ")).toMatchObject({ ok: true });
    expect(await postMessage(db, mona, general, "Thanks!")).toMatchObject({ ok: true });
    expect(await postMessage(db, mona, general, "   ")).toEqual({ ok: false, error: "Write a message first" });
    expect((await postMessage(db, mona, general, "x".repeat(MAX_BODY + 1))).ok).toBe(false);
    const msgs = await listMessages(db, omar.id, general);
    expect(msgs!.map((m) => [m.author, m.body])).toEqual([
      ["Retro", "Welcome to HQ chat"],
      ["Mona Ali", "Thanks!"],
    ]);
  });

  it("unread counts: other people's messages after my read position, cleared by reading", async () => {
    expect((await listConversations(db, omar.id)).channels[0].unread).toBe(2);
    expect((await listConversations(db, mona.id)).channels[0].unread).toBe(0); // replying marks what came before as read
    expect(await unreadTotal(db, omar.id)).toBe(2);
    const msgs = await listMessages(db, omar.id, general);
    await markRead(db, omar.id, general, msgs!.at(-1)!.id);
    expect(await unreadTotal(db, omar.id)).toBe(0);
    await markRead(db, omar.id, general, msgs![0].id); // reading older messages never moves the position back
    expect(await unreadTotal(db, omar.id)).toBe(0);
  });

  it("@mentions notify the person, with a link that reading the conversation clears", async () => {
    await postMessage(db, owner, general, "@Omar can you take the crown case? cc @MonaAli");
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.kind, "chat_mention"));
    expect(notes.map((n) => [n.userId, n.title, n.link]).sort()).toEqual(
      [
        [mona.id, "Retro mentioned you in #general", `/chat/${general}`],
        [omar.id, "Retro mentioned you in #general", `/chat/${general}`],
      ].sort(),
    );
    const [last] = (await listMessages(db, omar.id, general))!.slice(-1);
    await markRead(db, omar.id, general, last.id);
    const [n] = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, omar.id), eq(s.notifications.kind, "chat_mention")));
    expect(n.readAt).not.toBeNull();
  });

  it("direct messages: only their people can read them; the same group reopens the same DM; one notification until read", async () => {
    const dm = await openDm(db, mona.id, [omar.id]);
    if (!dm.ok) throw new Error(dm.error);
    expect(await openDm(db, omar.id, [mona.id, omar.id])).toEqual({ ok: true, id: dm.id });
    expect(await openDm(db, mona.id, [])).toMatchObject({ ok: false });
    expect(await openDm(db, mona.id, [999999])).toMatchObject({ ok: false });

    await postMessage(db, mona, dm.id, "Are you free at 3?");
    await postMessage(db, mona, dm.id, "For the case review");
    expect(await listMessages(db, owner.id, dm.id)).toBeNull(); // not even an owner reads other people's DMs
    expect(await getConversation(db, owner.id, dm.id)).toBeNull();
    expect(await postMessage(db, owner, dm.id, "hi")).toMatchObject({ ok: false });
    const c = await getConversation(db, omar.id, dm.id);
    expect(c).toMatchObject({ kind: "dm", title: "Mona Ali", joined: true });

    const dmNotes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, omar.id), eq(s.notifications.kind, "chat_dm")));
    expect(dmNotes.map((n) => n.title)).toEqual(["New message from Mona Ali"]);
    const list = await listConversations(db, omar.id);
    expect(list.dms.map((x) => [x.title, x.unread])).toEqual([["Mona Ali", 2]]);

    // a group DM is a different conversation
    const group = await openDm(db, mona.id, [omar.id, owner.id]);
    expect(group.ok && group.id).not.toBe(dm.id);
  });

  it("channels: create, browse and join (history not unread), leave; names are unique", async () => {
    const r = await createChannel(db, mona.id, { name: "Sales Team", topic: "Leads and offers" });
    if (!r.ok) throw new Error(r.error);
    expect(await createChannel(db, omar.id, { name: "sales team" })).toEqual({ ok: false, error: "#sales-team already exists" });
    expect(await createChannel(db, omar.id, { name: "!" })).toMatchObject({ ok: false });
    await postMessage(db, mona, r.id, "First offer is out");

    let omarList = await listConversations(db, omar.id);
    expect(omarList.browse).toEqual([{ id: r.id, name: "sales-team", topic: "Leads and offers" }]);
    expect(omarList.channels.map((c) => c.title)).toEqual(["general"]);
    expect(await listMessages(db, omar.id, r.id)).toHaveLength(1); // open channels can be read before joining

    await joinChannel(db, omar.id, r.id);
    omarList = await listConversations(db, omar.id);
    expect(omarList.channels.find((c) => c.id === r.id)?.unread).toBe(0);
    await postMessage(db, mona, r.id, "Second one too");
    expect((await listConversations(db, omar.id)).channels.find((c) => c.id === r.id)?.unread).toBe(1);

    expect(await leaveChannel(db, omar.id, r.id)).toEqual({ ok: true });
    expect(await leaveChannel(db, omar.id, general)).toMatchObject({ ok: false });
    expect((await listConversations(db, omar.id)).browse.map((b) => b.id)).toEqual([r.id]);
    // posting in a channel joins it
    await postMessage(db, omar, r.id, "Back in");
    expect((await listConversations(db, omar.id)).channels.map((c) => c.title)).toContain("sales-team");
  });

  it("only the creator or an owner renames or archives a channel; archived channels take no new messages", async () => {
    const [c] = await db.select().from(s.chatChannels).where(eq(s.chatChannels.name, "sales-team"));
    expect(await updateChannel(db, omar, c.id, { name: "x-team" })).toMatchObject({ ok: false });
    expect(await updateChannel(db, mona, c.id, { name: "General" })).toEqual({ ok: false, error: "#general already exists" });
    expect(await updateChannel(db, mona, c.id, { name: "Sales", topic: "Offers" })).toEqual({ ok: true });
    expect(await archiveChannel(db, omar, c.id)).toMatchObject({ ok: false });
    expect(await archiveChannel(db, mona, general)).toMatchObject({ ok: false });
    expect(await archiveChannel(db, owner, c.id)).toEqual({ ok: true });
    expect((await listConversations(db, mona.id)).channels.map((x) => x.title)).toEqual(["general"]);
    expect(await postMessage(db, mona, c.id, "still here?")).toEqual({ ok: false, error: "This channel is archived" });
    expect(await getConversation(db, mona.id, c.id)).toMatchObject({ archived: true, name: "sales" });
  });

  it("edits and deletes: your own messages; an owner may delete anyone's; polling sees the changes", async () => {
    const before = new Date(Date.now() - 1000);
    const r = await postMessage(db, mona, general, "Meeting at 4");
    if (!r.ok) throw new Error(r.error);
    expect(await editMessage(db, omar, r.id, "hacked")).toMatchObject({ ok: false });
    expect(await editMessage(db, owner, r.id, "owners cannot edit either")).toMatchObject({ ok: false });
    expect(await editMessage(db, mona, r.id, "Meeting at 5")).toEqual({ ok: true });
    let changed = await changedSince(db, omar.id, general, before);
    expect(changed!.find((m) => m.id === r.id)).toMatchObject({ body: "Meeting at 5", deleted: false });
    expect(changed!.find((m) => m.id === r.id)!.editedAt).not.toBeNull();

    expect(await deleteMessage(db, omar, r.id)).toMatchObject({ ok: false });
    expect(await deleteMessage(db, owner, r.id)).toEqual({ ok: true });
    expect(await deleteMessage(db, owner, r.id)).toMatchObject({ ok: false });
    changed = await changedSince(db, omar.id, general, before);
    expect(changed!.find((m) => m.id === r.id)).toMatchObject({ body: "", deleted: true });
    const [audited] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "chat_message"), eq(s.auditLog.action, "delete")));
    expect(audited.entityId).toBe(String(r.id));
  });

  it("older pages load before a message id", async () => {
    for (let i = 0; i < 60; i++) await postMessage(db, omar, general, `line ${i}`);
    const latest = await listMessages(db, mona.id, general);
    expect(latest).toHaveLength(50);
    expect(latest!.at(-1)!.body).toBe("line 59");
    const older = await listMessages(db, mona.id, general, { before: latest![0].id });
    expect(older!.at(-1)!.id).toBeLessThan(latest![0].id);
    expect(older!.length).toBeGreaterThan(0);
  });
});
