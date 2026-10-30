import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { announcementReceipts, announcements, notifications, users } from "@/db/schema";
import { audit } from "./audit";
import type { Role } from "./rbac";
import type { Fail } from "./result";

// Targeted announcements (HQ brief: announcements to the people who need them, with read and acknowledge tracking
// and reminders to non-readers). Company-wide blasts make people tune out, so an audience can be chosen by role.

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owners",
  sales: "Sales",
  viewer: "Viewers",
  finance: "Finance",
  instructor: "Instructors",
  designer: "Designers",
  marketing: "Marketing",
};
const ROLES = Object.keys(ROLE_LABEL) as Role[];

export const announcementLink = (id: number) => `/announcements/${id}`;
const REMIND_EVERY_MS = 24 * 3_600_000;
const REMIND_FOR_MS = 14 * 86_400_000;

export type AnnouncementInput = { title: string; body?: string; audience?: string[]; pinned?: boolean; mustAck?: boolean };

export async function publish(db: Db, author: { id: number; name: string }, input: AnnouncementInput): Promise<{ ok: true; id: number; people: number } | Fail> {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give it a title" };
  const audience = [...new Set((input.audience ?? []).filter((r): r is Role => ROLES.includes(r as Role)))];
  const people = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.active, true), audience.length ? inArray(users.role, audience) : undefined));
  if (!people.length) return { ok: false, error: "Nobody is in that audience" };
  const now = new Date();
  const [row] = await db
    .insert(announcements)
    .values({ title, body: input.body?.trim().slice(0, 20_000) ?? "", audience, pinned: !!input.pinned, mustAck: !!input.mustAck, authorId: author.id, publishedAt: now })
    .returning({ id: announcements.id });
  // the author has read their own; everyone else gets a receipt to fill and a notification
  await db.insert(announcementReceipts).values(people.map((p) => ({ announcementId: row.id, userId: p.id, readAt: p.id === author.id ? now : null, acknowledgedAt: p.id === author.id ? now : null })));
  const others = people.filter((p) => p.id !== author.id);
  if (others.length)
    await db.insert(notifications).values(
      others.map((p) => ({ userId: p.id, kind: "announcement", title: `${input.mustAck ? "Please read: " : ""}${title}`, link: announcementLink(row.id) })),
    );
  await audit(db, { userId: author.id, entity: "announcement", entityId: row.id, action: "publish", diff: { audience, mustAck: !!input.mustAck, people: people.length } });
  return { ok: true, id: row.id, people: people.length };
}

export type FeedItem = typeof announcements.$inferSelect & { author: string | null; readAt: Date | null; acknowledgedAt: Date | null };

/** What was sent to me, pinned first, then newest. */
export async function feed(db: Db, userId: number, limit = 50): Promise<FeedItem[]> {
  const rows = await db
    .select({ a: announcements, author: users.name, readAt: announcementReceipts.readAt, acknowledgedAt: announcementReceipts.acknowledgedAt })
    .from(announcementReceipts)
    .innerJoin(announcements, eq(announcements.id, announcementReceipts.announcementId))
    .leftJoin(users, eq(users.id, announcements.authorId))
    .where(and(eq(announcementReceipts.userId, userId), isNull(announcements.archivedAt)))
    .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.a, author: r.author, readAt: r.readAt, acknowledgedAt: r.acknowledgedAt }));
}

/** Announcements I have not opened, and must-reads I have not acknowledged. */
export async function unreadCounts(db: Db, userId: number) {
  const [r] = await db
    .select({
      unread: sql<number>`count(*) filter (where ${announcementReceipts.readAt} is null)::int`,
      toAck: sql<number>`count(*) filter (where ${announcements.mustAck} and ${announcementReceipts.acknowledgedAt} is null)::int`,
    })
    .from(announcementReceipts)
    .innerJoin(announcements, eq(announcements.id, announcementReceipts.announcementId))
    .where(and(eq(announcementReceipts.userId, userId), isNull(announcements.archivedAt)));
  return r;
}

/** One announcement for one reader; opening it marks it read (and clears its notifications). Null if not theirs. */
export async function openAnnouncement(db: Db, userId: number, id: number, opts: { canSeeAll: boolean }) {
  const [a] = await db.select({ a: announcements, author: users.name }).from(announcements).leftJoin(users, eq(users.id, announcements.authorId)).where(eq(announcements.id, id));
  if (!a) return null;
  const [mine] = await db.select().from(announcementReceipts).where(and(eq(announcementReceipts.announcementId, id), eq(announcementReceipts.userId, userId)));
  if (!mine && !opts.canSeeAll) return null;
  if (mine && !mine.readAt) {
    await db.update(announcementReceipts).set({ readAt: new Date() }).where(and(eq(announcementReceipts.announcementId, id), eq(announcementReceipts.userId, userId)));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.link, announcementLink(id)), isNull(notifications.readAt)));
  }
  return { ...a.a, author: a.author, receipt: mine ?? null };
}

export async function acknowledge(db: Db, userId: number, id: number): Promise<{ ok: true } | Fail> {
  const [a] = await db.select({ mustAck: announcements.mustAck, archivedAt: announcements.archivedAt }).from(announcements).where(eq(announcements.id, id));
  if (!a || a.archivedAt) return { ok: false, error: "That announcement is gone" };
  if (!a.mustAck) return { ok: false, error: "This one does not need an acknowledgement" };
  const now = new Date();
  const done = await db
    .update(announcementReceipts)
    .set({ acknowledgedAt: now, readAt: sql`coalesce(${announcementReceipts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(announcementReceipts.announcementId, id), eq(announcementReceipts.userId, userId), isNull(announcementReceipts.acknowledgedAt)))
    .returning({ u: announcementReceipts.userId });
  if (!done.length) return { ok: false, error: "Already acknowledged, or not sent to you" };
  await audit(db, { userId, entity: "announcement", entityId: id, action: "acknowledge" });
  return { ok: true };
}

/** For the author and owners: who it went to, who opened it, who acknowledged. */
export async function tracking(db: Db, id: number) {
  return db
    .select({ id: users.id, name: users.name, role: users.role, readAt: announcementReceipts.readAt, acknowledgedAt: announcementReceipts.acknowledgedAt, remindedAt: announcementReceipts.remindedAt })
    .from(announcementReceipts)
    .innerJoin(users, eq(users.id, announcementReceipts.userId))
    .where(eq(announcementReceipts.announcementId, id))
    .orderBy(asc(users.name));
}

export async function setArchived(db: Db, actor: number, id: number, archived: boolean): Promise<{ ok: true } | Fail> {
  const done = await db.update(announcements).set({ archivedAt: archived ? new Date() : null }).where(eq(announcements.id, id)).returning({ id: announcements.id });
  if (!done.length) return { ok: false, error: "That announcement does not exist" };
  await audit(db, { userId: actor, entity: "announcement", entityId: id, action: archived ? "archive" : "restore" });
  return { ok: true };
}

export async function setPinned(db: Db, actor: number, id: number, pinned: boolean): Promise<{ ok: true } | Fail> {
  const done = await db.update(announcements).set({ pinned }).where(eq(announcements.id, id)).returning({ id: announcements.id });
  if (!done.length) return { ok: false, error: "That announcement does not exist" };
  await audit(db, { userId: actor, entity: "announcement", entityId: id, action: pinned ? "pin" : "unpin" });
  return { ok: true };
}

/**
 * From the 5-minute tick: a reminder for each must-read not acknowledged after a day, at most once a day per person,
 * for two weeks after it was published.
 */
export async function remindUnacknowledged(db: Db, now = new Date()): Promise<number> {
  const due = await db
    .select({ announcementId: announcementReceipts.announcementId, userId: announcementReceipts.userId, title: announcements.title })
    .from(announcementReceipts)
    .innerJoin(announcements, eq(announcements.id, announcementReceipts.announcementId))
    .innerJoin(users, eq(users.id, announcementReceipts.userId))
    .where(
      and(
        eq(announcements.mustAck, true),
        isNull(announcements.archivedAt),
        isNull(announcementReceipts.acknowledgedAt),
        eq(users.active, true),
        lt(announcements.publishedAt, new Date(now.getTime() - REMIND_EVERY_MS)),
        gt(announcements.publishedAt, new Date(now.getTime() - REMIND_FOR_MS)),
        or(isNull(announcementReceipts.remindedAt), lt(announcementReceipts.remindedAt, new Date(now.getTime() - REMIND_EVERY_MS))),
      ),
    );
  for (const d of due) {
    await db.insert(notifications).values({ userId: d.userId, kind: "announcement", title: `Reminder, please read and acknowledge: ${d.title}`, link: announcementLink(d.announcementId) });
    await db
      .update(announcementReceipts)
      .set({ remindedAt: now })
      .where(and(eq(announcementReceipts.announcementId, d.announcementId), eq(announcementReceipts.userId, d.userId)));
  }
  return due.length;
}
