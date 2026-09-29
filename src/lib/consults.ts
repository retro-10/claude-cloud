import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, consultObjections, consults, leads, stages } from "@/db/schema";
import { audit } from "./audit";
import { moveStageTx, type Tx } from "./leads";

type Consult = typeof consults.$inferSelect;
export type Outcome = NonNullable<Consult["outcome"]>;
export const HELD_OUTCOMES = ["enrolled", "thinking", "not_fit"] as const;

// Moves the lead forward to `toKey` only if it is in an open stage that comes earlier in the pipeline.
// Never moves backwards, and leaves won, lost and nurture leads where they are.
async function advanceStage(tx: Tx, leadId: number, toKey: string, userId: number | null) {
  const [lead] = await tx.select({ stage: leads.stage }).from(leads).where(eq(leads.id, leadId));
  const list = await tx.select().from(stages);
  const cur = list.find((s) => s.key === lead?.stage);
  const target = list.find((s) => s.key === toKey);
  if (cur && target && cur.kind === "open" && cur.position < target.position) await moveStageTx(tx, leadId, toKey, userId);
}

export async function bookConsult(
  db: Db,
  input: { leadId: number; scheduledAt: Date; notes?: string | null },
  userId: number | null,
): Promise<Consult | null> {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select({ id: leads.id, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, input.leadId));
    if (!lead || lead.deletedAt) return null;
    const [row] = await tx
      .insert(consults)
      .values({ leadId: input.leadId, scheduledAt: input.scheduledAt, notes: input.notes?.trim() || null })
      .returning();
    await advanceStage(tx, input.leadId, "consult_booked", userId);
    await audit(tx, { userId, entity: "consult", entityId: row.id, action: "book" });
    return row;
  });
}

export type MarkInput = {
  consultId: number;
  result: "held" | "no_show";
  outcome?: Outcome | null; // required when held
  objectionIds?: number[];
  notes?: string | null;
};
export type MarkResult = { ok: true } | { ok: false; error: string };

export async function markConsult(db: Db, input: MarkInput, userId: number | null): Promise<MarkResult> {
  const held = input.result === "held";
  if (held && !(HELD_OUTCOMES as readonly string[]).includes(input.outcome ?? "")) {
    return { ok: false, error: "Pick an outcome for a consult that was held" };
  }
  return db.transaction(async (tx): Promise<MarkResult> => {
    const [c] = await tx.select().from(consults).where(eq(consults.id, input.consultId)).for("update");
    if (!c) return { ok: false, error: "Consult not found" };

    await tx
      .update(consults)
      .set({
        held,
        outcome: held ? input.outcome! : "no_show",
        notes: input.notes === undefined ? c.notes : input.notes?.trim() || null,
      })
      .where(eq(consults.id, c.id));

    // objection tags describe a consult that took place; replace the set each time it is (re)marked
    await tx.delete(consultObjections).where(eq(consultObjections.consultId, c.id));
    const ids = held ? [...new Set(input.objectionIds ?? [])] : [];
    if (ids.length) {
      await tx.insert(consultObjections).values(ids.map((objectionId) => ({ consultId: c.id, objectionId })));
    }

    await tx.insert(activities).values({
      leadId: c.leadId,
      type: "consult",
      direction: "internal",
      body: held ? `Consult held: ${input.outcome!.replace("_", " ")}` : "Consult: no-show",
      byUserId: userId,
    });
    if (held) await advanceStage(tx, c.leadId, "consult_held", userId);
    await audit(tx, { userId, entity: "consult", entityId: c.id, action: held ? "held" : "no_show", diff: { outcome: held ? input.outcome : "no_show" } });
    return { ok: true };
  });
}

export async function consultObjectionIds(db: Pick<Db, "select">, consultIds: number[]) {
  if (!consultIds.length) return new Map<number, number[]>();
  const rows = await db.select().from(consultObjections).where(inArray(consultObjections.consultId, consultIds));
  const m = new Map<number, number[]>();
  for (const r of rows) m.set(r.consultId, [...(m.get(r.consultId) ?? []), r.objectionId]);
  return m;
}

export async function rescheduleConsult(db: Db, consultId: number, scheduledAt: Date, userId: number | null) {
  const rows = await db
    .update(consults)
    .set({ scheduledAt })
    .where(and(eq(consults.id, consultId), eq(consults.held, false)))
    .returning({ id: consults.id });
  if (rows.length) await audit(db, { userId, entity: "consult", entityId: consultId, action: "reschedule" });
  return rows.length > 0;
}
