import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, notifications, users } from "@/db/schema";
import { audit } from "./audit";
import { applyCadence } from "./followups";
import { changeStage } from "./leads";
import { fireRules } from "./workflows";

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
  const before = await db.select({ id: leads.id, ownerId: leads.ownerId }).from(leads).where(and(inArray(leads.id, list), isNull(leads.deletedAt)));
  const changed = before.filter((b) => b.ownerId !== ownerId);
  await db.transaction(async (tx) => {
    if (changed.length) await tx.update(leads).set({ ownerId, updatedAt: new Date() }).where(inArray(leads.id, changed.map((c) => c.id)));
    // the owner's own rules still run per lead, but the new owner gets one message, not one per lead
    for (const c of changed) await fireRules(tx as unknown as Db, { trigger: "owner_changed", leadId: c.id, from: c.ownerId, to: ownerId }, userId, { skipKeys: ["owner_assigned"] });
    if (ownerId && changed.length && ownerId !== userId)
      await tx.insert(notifications).values({ userId: ownerId, kind: "owner_assigned", title: changed.length === 1 ? "A lead is now yours" : `${changed.length} leads are now yours`, leadId: changed.length === 1 ? changed[0].id : null });
  });
  res.done = before.length;
  res.skipped = list.length - before.length;
  if (res.skipped) res.reasons.push("Lead not found");
  await audit(db, { userId, entity: "lead", action: "bulk_assign", diff: { count: changed.length, ownerId } });
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
