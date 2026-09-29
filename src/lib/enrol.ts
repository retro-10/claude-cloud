import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads } from "@/db/schema";
import { audit } from "./audit";
import { moveStageTx } from "./leads";

export type EnrolInput = {
  leadId: number;
  cohortId: number;
  tier: (typeof enrolments.$inferInsert)["tier"];
  amountEgp: number;
  paidAt?: Date | null;
  paymentRef?: string | null;
  gateway?: (typeof enrolments.$inferInsert)["gateway"];
  overrideCap?: boolean; // caller must only pass true for users allowed to override
};

export type EnrolResult =
  | { ok: true; enrolmentId: number; seatsUsed: number; seatCap: number }
  | { ok: false; error: "cohort_full"; seatsUsed: number; seatCap: number }
  | { ok: false; error: "not_found" | "already_enrolled" | "invalid_amount" };

export async function seatsUsed(db: Pick<Db, "select">, cohortId: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enrolments)
    .where(eq(enrolments.cohortId, cohortId));
  return r.n;
}

// Records the enrolment and moves the lead to the won stage in one transaction.
// The cohort row is locked first, so two simultaneous enrolments cannot both take the last seat.
export async function enrolLead(db: Db, input: EnrolInput, userId: number | null): Promise<EnrolResult> {
  if (!Number.isInteger(input.amountEgp) || input.amountEgp <= 0) return { ok: false, error: "invalid_amount" };

  return db.transaction(async (tx): Promise<EnrolResult> => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, input.cohortId)).for("update");
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId));
    if (!cohort || !lead || lead.deletedAt) return { ok: false, error: "not_found" };

    const [dupe] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(and(eq(enrolments.leadId, input.leadId), eq(enrolments.cohortId, input.cohortId)));
    if (dupe) return { ok: false, error: "already_enrolled" };

    const used = await seatsUsed(tx, cohort.id);
    if (used >= cohort.seatCap && !input.overrideCap) {
      return { ok: false, error: "cohort_full", seatsUsed: used, seatCap: cohort.seatCap };
    }

    const [row] = await tx
      .insert(enrolments)
      .values({
        leadId: input.leadId,
        cohortId: input.cohortId,
        tier: input.tier,
        amountEgp: input.amountEgp,
        paidAt: input.paidAt ?? null,
        paymentRef: input.paymentRef?.trim() || null,
        gateway: input.gateway ?? "other",
      })
      .returning();

    const moved = await moveStageTx(tx, input.leadId, "enrolled", userId, { viaEnrolment: true });
    if (!moved.ok) throw new Error(moved.error); // aborts the transaction: no enrolment without the stage move

    await audit(tx, {
      userId,
      entity: "enrolment",
      entityId: row.id,
      action: used >= cohort.seatCap ? "create_over_cap" : "create",
      diff: { leadId: input.leadId, cohortId: input.cohortId, tier: input.tier, amountEgp: input.amountEgp },
    });
    return { ok: true, enrolmentId: row.id, seatsUsed: used + 1, seatCap: cohort.seatCap };
  });
}
