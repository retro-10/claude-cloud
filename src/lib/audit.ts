import type { Db } from "@/db";
import { auditLog } from "@/db/schema";

type Executor = Pick<Db, "insert">;

// Never put lead PII into `diff` beyond field names and ids; store what changed, not personal data.
export async function audit(
  db: Executor,
  entry: { userId: number | null; entity: string; entityId?: string | number; action: string; diff?: unknown },
) {
  await db.insert(auditLog).values({
    userId: entry.userId,
    entity: entry.entity,
    entityId: entry.entityId === undefined ? null : String(entry.entityId),
    action: entry.action,
    diff: entry.diff ?? null,
  });
}
