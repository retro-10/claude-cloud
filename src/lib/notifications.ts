import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { notifications } from "@/db/schema";

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
