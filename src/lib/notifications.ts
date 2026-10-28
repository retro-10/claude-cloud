import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { notifications } from "@/db/schema";

/** Where a notification opens: its own link (a chat conversation), else the lead it is about. */
export const notificationHref = (n: { link: string | null; leadId: number | null }) => n.link ?? (n.leadId ? `/leads/${n.leadId}` : null);

export async function recentNotifications(db: Db, userId: number, limit = 12) {
  const [items, [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit),
    db.select({ unread: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread };
}

export async function markAllRead(db: Db, userId: number) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** The Inbox: everything that was sent to a person, newest first, unread ("New") or already seen ("Cleared"). */
export async function inbox(db: Db, userId: number, tab: "new" | "cleared", limit = 200) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), tab === "new" ? isNull(notifications.readAt) : sql`${notifications.readAt} is not null`))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

/** Clear (mark read) or bring back (mark unread) one notification of this person's. */
export async function setRead(db: Db, userId: number, id: number, read: boolean) {
  const rows = await db
    .update(notifications)
    .set({ readAt: read ? new Date() : null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}
