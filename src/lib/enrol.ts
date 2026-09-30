import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads, ledgerEntries } from "@/db/schema";
import { audit } from "./audit";
import { missingFor, type Missing } from "./exit-criteria";
import { moveStageTx } from "./leads";

export type EnrolInput = {
  leadId: number;
  cohortId: number;
  tier: (typeof enrolments.$inferInsert)["tier"];
  amountEgp: number; // agreed tier price, before any discount
  discountEgp?: number;
  paymentPlan?: (typeof enrolments.$inferInsert)["paymentPlan"];
  // the payment made now (Received), with its transfer / receipt reference; candidates pay OrlaDent directly
  paidAmountEgp?: number | null;
  paidAt?: Date | null;
  paymentRef?: string | null;
  // instalments: when the rest is due (recorded as an Expected payment for the remainder)
  finalInstalmentAt?: Date | null;
  overrideCap?: boolean; // caller must only pass true for users allowed to override
  overrideCriteria?: string | null; // owner override of unmet exit criteria, with a reason
};

export type EnrolResult =
  | { ok: true; enrolmentId: number; seatsUsed: number; seatCap: number }
  | { ok: false; error: "cohort_full"; seatsUsed: number; seatCap: number }
  | { ok: false; error: "not_found" | "already_enrolled" | "invalid_amount" }
  | { ok: false; error: "criteria"; missing: Missing[] };

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
  const plan = input.paymentPlan ?? "one_time";
  const discount = input.discountEgp ?? 0;
  if (!Number.isInteger(input.amountEgp) || input.amountEgp <= 0) return { ok: false, error: "invalid_amount" };
  if (!Number.isInteger(discount) || discount < 0 || discount > input.amountEgp) return { ok: false, error: "invalid_amount" };
  const due = plan === "free_seat" ? 0 : input.amountEgp - discount;
  // one-time: the payment now is the whole amount unless stated; instalments: whatever was paid now
  const paidNow = plan === "free_seat" ? 0 : (input.paidAmountEgp ?? (plan === "one_time" && input.paymentRef ? due : 0));
  if (!Number.isInteger(paidNow) || paidNow < 0 || paidNow > due) return { ok: false, error: "invalid_amount" };

  return db.transaction(async (tx): Promise<EnrolResult> => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, input.cohortId)).for("update");
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId));
    if (!cohort || !lead || lead.deletedAt) return { ok: false, error: "not_found" };

    const [dupe] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(and(eq(enrolments.leadId, input.leadId), eq(enrolments.cohortId, input.cohortId)));
    if (dupe) return { ok: false, error: "already_enrolled" };

    // P1: "Offer sent to Enrolled: payment confirmed with a payment reference"
    // a free seat has nothing to confirm; otherwise a received payment with its reference
    const ref = plan === "free_seat" ? "free seat" : paidNow > 0 ? input.paymentRef : null;
    const missing = await missingFor(tx, input.leadId, "enrolled", { paymentRef: ref });
    if (missing.length && !input.overrideCriteria?.trim()) return { ok: false, error: "criteria", missing };

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
        discountEgp: discount,
        paymentPlan: plan,
        firstInstalmentAt: plan === "installments" && paidNow > 0 ? (input.paidAt ?? new Date()) : null,
        finalInstalmentAt: plan === "installments" ? (input.finalInstalmentAt ?? null) : null,
      })
      .returning();

    if (paidNow > 0) {
      await tx.insert(ledgerEntries).values({
        entry: `${lead.fullName} — ${plan === "installments" ? "first installment" : "payment"}`,
        amountEgp: paidNow,
        date: input.paidAt ?? new Date(),
        section: "income",
        category: "Candidate payment",
        status: "received",
        reference: input.paymentRef?.trim() || null,
        enrolmentId: row.id,
        cohortId: input.cohortId,
        createdBy: userId,
      });
    }
    if (due - paidNow > 0 && (plan === "installments" || paidNow === 0)) {
      await tx.insert(ledgerEntries).values({
        entry: `${lead.fullName} — ${plan === "installments" ? "final installment" : "payment due"}`,
        amountEgp: due - paidNow,
        date: input.finalInstalmentAt ?? null,
        section: "income",
        category: "Candidate payment",
        status: "expected",
        enrolmentId: row.id,
        cohortId: input.cohortId,
        createdBy: userId,
      });
    }

    const moved = await moveStageTx(tx, input.leadId, "enrolled", userId, {
      viaEnrolment: true,
      paymentRef: ref,
      override: input.overrideCriteria,
    });
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
