"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { enrolLead } from "@/lib/enrol";
import type { Missing } from "@/lib/exit-criteria";
import { changeStage } from "@/lib/leads";
import { can } from "@/lib/rbac";
import { requireCan } from "@/lib/server-auth";
import { followUpDue } from "@/lib/time";

export type MoveResult = { ok: true } | { ok: false; error: string; missing?: Missing[]; canOverride?: boolean };

const moveSchema = z.object({
  leadId: z.number().int().positive(),
  stage: z.string().min(1).max(50),
  lostReasonId: z.number().int().positive().nullable().optional(),
  nextStepDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  override: z.string().max(500).nullable().optional(),
});

// Used by the board, the lead page and the review lists. Exit criteria (P1) are checked on the server;
// only owners may override them, and only with a reason, which goes to the audit log.
export async function moveLead(input: unknown): Promise<MoveResult> {
  const user = await requireCan("lead:write");
  const p = moveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request" };
  const canOverride = can(user.role, "stage:override");
  const r = await changeStage(db, p.data.leadId, p.data.stage, user.id, {
    lostReasonId: p.data.lostReasonId ?? null,
    nextStepDate: p.data.nextStepDate ? followUpDue(p.data.nextStepDate) : null,
    override: canOverride ? (p.data.override ?? null) : null,
  });
  if (r.ok) {
    revalidatePath("/pipeline");
    revalidatePath(`/leads/${p.data.leadId}`);
    revalidatePath("/", "layout");
    return { ok: true };
  }
  return { ...r, canOverride };
}

const enrolSchema = z.object({
  leadId: z.number().int().positive(),
  cohortId: z.number().int().positive(),
  tier: z.enum(["foundation", "freelance_ready", "production_partner"]),
  amountEgp: z.number().int().positive().max(10_000_000),
  discountEgp: z.number().int().min(0).max(10_000_000).default(0),
  paymentPlan: z.enum(["one_time", "installments", "free_seat"]).default("one_time"),
  paidAmountEgp: z.number().int().min(0).max(10_000_000).nullable().optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentRef: z.string().max(200).nullable().optional(),
  finalInstalmentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  overrideCap: z.boolean().optional(),
  overrideCriteria: z.string().max(500).nullable().optional(),
});

export type EnrolActionResult =
  | { ok: true; seatsUsed: number; seatCap: number }
  | { ok: false; error: string; cohortFull?: boolean; missing?: Missing[]; canOverride?: boolean };

export async function enrolAction(input: unknown): Promise<EnrolActionResult> {
  const user = await requireCan("lead:write");
  const p = enrolSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check tier, amount and batch." };

  // only owners may exceed the seat cap or skip exit criteria; the flags are ignored for anyone else
  const overrideCap = p.data.overrideCap === true && user.role === "owner";
  const canOverride = can(user.role, "stage:override");
  const r = await enrolLead(
    db,
    {
      leadId: p.data.leadId,
      cohortId: p.data.cohortId,
      tier: p.data.tier,
      amountEgp: p.data.amountEgp,
      discountEgp: p.data.discountEgp,
      paymentPlan: p.data.paymentPlan,
      paidAmountEgp: p.data.paidAmountEgp ?? null,
      paidAt: p.data.paidOn ? new Date(`${p.data.paidOn}T12:00:00Z`) : null,
      paymentRef: p.data.paymentRef,
      finalInstalmentAt: p.data.finalInstalmentOn ? new Date(`${p.data.finalInstalmentOn}T12:00:00Z`) : null,
      overrideCap,
      overrideCriteria: canOverride ? p.data.overrideCriteria : null,
    },
    user.id,
  );
  if (r.ok) {
    revalidatePath("/pipeline");
    revalidatePath(`/leads/${p.data.leadId}`);
    return { ok: true, seatsUsed: r.seatsUsed, seatCap: r.seatCap };
  }
  switch (r.error) {
    case "cohort_full":
      return {
        ok: false,
        cohortFull: true,
        error:
          user.role === "owner"
            ? `Batch is full (${r.seatsUsed}/${r.seatCap}). Tick "override" to add a seat anyway.`
            : `Batch is full (${r.seatsUsed}/${r.seatCap}). Ask an owner to override.`,
      };
    case "criteria":
      return { ok: false, error: "Record the payment received and its reference (or choose a free seat) before enrolling.", missing: r.missing, canOverride };
    case "already_enrolled":
      return { ok: false, error: "This lead is already enrolled in that batch." };
    case "invalid_amount":
      return { ok: false, error: "Check the amounts: price above zero, discount and payment not more than the price." };
    default:
      return { ok: false, error: "Lead or batch not found." };
  }
}
