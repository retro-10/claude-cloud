import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, users } from "@/db/schema";

export const AUDIT_PAGE_SIZE = 50;

export async function listAudit(db: Db, f: { entity?: string; userId?: number; page?: number }) {
  const where = and(f.entity ? eq(auditLog.entity, f.entity) : undefined, f.userId ? eq(auditLog.userId, f.userId) : undefined);
  const page = Math.max(1, f.page ?? 1);
  const [rows, [{ n }], entities] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        action: auditLog.action,
        diff: auditLog.diff,
        user: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
    db.selectDistinct({ entity: auditLog.entity }).from(auditLog).orderBy(auditLog.entity),
  ]);
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / AUDIT_PAGE_SIZE)), entities: entities.map((e) => e.entity) };
}
