import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { cadenceTemplates, followUps, leads, stages } from "@/db/schema";
import { audit } from "./audit";
import { addDaysYmd, cairoYmd, followUpDue } from "./time";

type Executor = Pick<Db, "update">;

/**
 * Stop rule: cancel a lead's open cadence follow-ups (those created from a template).
 * Manual follow-ups (template_id NULL) are never touched. Returns how many were cancelled.
 */
export async function cancelCadenceFollowUps(tx: Executor, leadId: number): Promise<number> {
  const rows = await tx
    .update(followUps)
    .set({ cancelledAt: new Date() })
    .where(
      and(eq(followUps.leadId, leadId), isNotNull(followUps.templateId), isNull(followUps.doneAt), isNull(followUps.cancelledAt)),
    )
    .returning({ id: followUps.id });
  return rows.length;
}

export async function createFollowUp(
  db: Db,
  input: { leadId: number; dueAt: Date; kind?: string; note?: string | null },
  userId: number | null,
) {
  const [lead] = await db.select({ id: leads.id, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, input.leadId));
  if (!lead || lead.deletedAt) return null;
  const [row] = await db
    .insert(followUps)
    .values({ leadId: input.leadId, dueAt: input.dueAt, kind: input.kind ?? "whatsapp", note: input.note?.trim() || null, createdBy: userId })
    .returning();
  return row;
}

export async function completeFollowUp(db: Db, id: number, userId: number | null) {
  const rows = await db
    .update(followUps)
    .set({ doneAt: new Date() })
    .where(and(eq(followUps.id, id), isNull(followUps.doneAt), isNull(followUps.cancelledAt)))
    .returning({ id: followUps.id, leadId: followUps.leadId });
  if (rows.length) await audit(db, { userId, entity: "follow_up", entityId: id, action: "done" });
  return rows.length > 0;
}

export async function rescheduleFollowUp(db: Db, id: number, dueAt: Date, userId: number | null) {
  const rows = await db
    .update(followUps)
    .set({ dueAt })
    .where(and(eq(followUps.id, id), isNull(followUps.doneAt), isNull(followUps.cancelledAt)))
    .returning({ id: followUps.id });
  if (rows.length) await audit(db, { userId, entity: "follow_up", entityId: id, action: "reschedule" });
  return rows.length > 0;
}

export async function cancelFollowUp(db: Db, id: number, userId: number | null) {
  const rows = await db
    .update(followUps)
    .set({ cancelledAt: new Date() })
    .where(and(eq(followUps.id, id), isNull(followUps.doneAt), isNull(followUps.cancelledAt)))
    .returning({ id: followUps.id });
  if (rows.length) await audit(db, { userId, entity: "follow_up", entityId: id, action: "cancel" });
  return rows.length > 0;
}

export type ApplyCadenceResult =
  | { ok: true; created: number; dueDates: Date[] }
  | { ok: false; error: "not_found" | "closed" | "already_applied" | "empty_template" };

/**
 * Creates one follow-up per template step. Day 0 is the Cairo calendar date of `start` (default: today);
 * each step is due at 09:00 Cairo on day 0 + offset_days. The message hint goes in `note`; nothing is sent.
 */
export async function applyCadence(
  db: Db,
  input: { leadId: number; templateId: number; start?: Date },
  userId: number | null,
): Promise<ApplyCadenceResult> {
  return db.transaction(async (tx): Promise<ApplyCadenceResult> => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId));
    const [tpl] = await tx.select().from(cadenceTemplates).where(eq(cadenceTemplates.id, input.templateId));
    if (!lead || lead.deletedAt || !tpl) return { ok: false, error: "not_found" };
    if (!tpl.steps.length) return { ok: false, error: "empty_template" };

    const [stage] = await tx.select().from(stages).where(eq(stages.key, lead.stage));
    if (stage && (stage.kind === "won" || stage.kind === "lost")) return { ok: false, error: "closed" };

    const [open] = await tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(
        and(eq(followUps.leadId, lead.id), eq(followUps.templateId, tpl.id), isNull(followUps.doneAt), isNull(followUps.cancelledAt)),
      )
      .limit(1);
    if (open) return { ok: false, error: "already_applied" };

    const day0 = cairoYmd(input.start ?? new Date());
    const steps = [...tpl.steps].sort((a, b) => a.offset_days - b.offset_days);
    const dueDates = steps.map((s) => followUpDue(addDaysYmd(day0, s.offset_days))!);
    await tx.insert(followUps).values(
      steps.map((s, i) => ({
        leadId: lead.id,
        dueAt: dueDates[i],
        kind: s.kind,
        note: s.message_hint,
        createdBy: userId,
        templateId: tpl.id,
      })),
    );
    await audit(tx, { userId, entity: "lead", entityId: lead.id, action: "apply_cadence", diff: { template: tpl.name, steps: steps.length } });
    return { ok: true, created: steps.length, dueDates };
  });
}
