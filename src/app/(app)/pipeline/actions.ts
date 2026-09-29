"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { enrolLead } from "@/lib/enrol";
import { changeStage } from "@/lib/leads";
import { requireCan } from "@/lib/server-auth";

export type MoveResult = { ok: true } | { ok: false; error: string };

const moveSchema = z.object({
  leadId: z.number().int().positive(),
  stage: z.string().min(1).max(50),
  lostReasonId: z.number().int().positive().nullable().optional(),
});

export async function moveLead(input: unknown): Promise<MoveResult> {
  const user = await requireCan("lead:write");
  const p = moveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request" };
  const r = await changeStage(db, p.data.leadId, p.data.stage, user.id, { lostReasonId: p.data.lostReasonId ?? null });
  if (r.ok) revalidatePath("/pipeline");
  return r;
}

const enrolSchema = z.object({
  leadId: z.number().int().positive(),
  cohortId: z.number().int().positive(),
  tier: z.enum(["foundation", "freelance_ready", "production_partner"]),
  amountEgp: z.number().int().positive().max(10_000_000),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  paymentRef: z.string().max(200).nullable().optional(),
  gateway: z.enum(["paymob", "other"]).default("other"),
  overrideCap: z.boolean().optional(),
});

export type EnrolActionResult =
  | { ok: true; seatsUsed: number; seatCap: number }
  | { ok: false; error: string; cohortFull?: boolean };

export async function enrolAction(input: unknown): Promise<EnrolActionResult> {
  const user = await requireCan("lead:write");
  const p = enrolSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check tier, amount and cohort." };

  // only owners may exceed the seat cap; the flag is ignored for anyone else
  const overrideCap = p.data.overrideCap === true && user.role === "owner";
  const r = await enrolLead(
    db,
    {
      leadId: p.data.leadId,
      cohortId: p.data.cohortId,
      tier: p.data.tier,
      amountEgp: p.data.amountEgp,
      paidAt: p.data.paidOn ? new Date(`${p.data.paidOn}T12:00:00Z`) : null,
      paymentRef: p.data.paymentRef,
      gateway: p.data.gateway,
      overrideCap,
    },
    user.id,
  );
  if (r.ok) {
    revalidatePath("/pipeline");
    return { ok: true, seatsUsed: r.seatsUsed, seatCap: r.seatCap };
  }
  switch (r.error) {
    case "cohort_full":
      return {
        ok: false,
        cohortFull: true,
        error:
          user.role === "owner"
            ? `Cohort is full (${r.seatsUsed}/${r.seatCap}). Tick "override" to add a seat anyway.`
            : `Cohort is full (${r.seatsUsed}/${r.seatCap}). Ask an owner to override.`,
      };
    case "already_enrolled":
      return { ok: false, error: "This lead is already enrolled in that cohort." };
    case "invalid_amount":
      return { ok: false, error: "Amount must be a whole number of EGP above zero." };
    default:
      return { ok: false, error: "Lead or cohort not found." };
  }
}
