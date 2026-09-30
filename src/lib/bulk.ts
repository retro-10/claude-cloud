import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, users } from "@/db/schema";
import { audit } from "./audit";
import { applyCadence } from "./followups";
import { changeStage } from "./leads";

export const BULK_MAX = 500;
export type BulkResult = { done: number; skipped: number; reasons: string[] };

const tally = (r: BulkResult, ok: boolean, why?: string) => {
  if (ok) r.done++;
  else {
    r.skipped++;
    if (why && !r.reasons.includes(why)) r.reasons.push(why);
  }
};

// Each lead is processed independently: one failure never blocks the rest.
export async function bulkChangeStage(db: Db, ids: number[], stage: string, userId: number | null, lostReasonId?: number | null): Promise<BulkResult> {
  const res: BulkResult = { done: 0, skipped: 0, reasons: [] };
  for (const id of ids.slice(0, BULK_MAX)) {
    const r = await changeStage(db, id, stage, userId, { lostReasonId });
    tally(res, r.ok, r.ok ? undefined : r.error);
  }
  return res;
}

export async function bulkAssign(db: Db, ids: number[], ownerId: number | null, userId: number | null): Promise<BulkResult> {
  const res: BulkResult = { done: 0, skipped: 0, reasons: [] };
  if (ownerId !== null) {
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.active, true)));
    if (!u) return { done: 0, skipped: ids.length, reasons: ["Unknown or inactive user"] };
  }
  const list = ids.slice(0, BULK_MAX);
  const rows = await db
    .update(leads)
    .set({ ownerId, updatedAt: new Date() })
    .where(and(inArray(leads.id, list), isNull(leads.deletedAt)))
    .returning({ id: leads.id });
  res.done = rows.length;
  res.skipped = list.length - rows.length;
  if (res.skipped) res.reasons.push("Lead not found");
  await audit(db, { userId, entity: "lead", action: "bulk_assign", diff: { count: rows.length, ownerId } });
  return res;
}

export async function bulkCadence(db: Db, ids: number[], templateId: number, userId: number | null): Promise<BulkResult> {
  const res: BulkResult = { done: 0, skipped: 0, reasons: [] };
  const msg = { not_found: "Lead not found", closed: "Lead is won or lost", already_applied: "Cadence already running", empty_template: "Template has no steps" };
  for (const id of ids.slice(0, BULK_MAX)) {
    const r = await applyCadence(db, { leadId: id, templateId }, userId);
    tally(res, r.ok, r.ok ? undefined : msg[r.error]);
  }
  return res;
}
