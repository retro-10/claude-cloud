"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { updateOffer } from "@/lib/leads";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

// Offer builder: store what was offered on the lead (tier, price after discount, link, decision date), the same
// fields the lead page's offer card edits. Nothing is sent from here.
export async function saveOfferToLeadAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z
    .object({
      leadId: z.coerce.number().int().positive(),
      tier: z.enum(["foundation", "freelance_ready", "production_partner"]),
      amount: z.coerce.number().int().positive(),
      link: z.string().max(500).optional(),
      decision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
    })
    .parse(Object.fromEntries(form));
  const r = await updateOffer(
    db,
    p.leadId,
    { offerTier: p.tier, offerAmountEgp: p.amount, offerPaymentLink: p.link?.trim() || null, decisionDueAt: p.decision ? cairoLocalToDate(`${p.decision}T12:00`) : undefined },
    user.id,
  );
  revalidatePath(`/leads/${p.leadId}`);
  redirect(r.ok ? `/leads/${p.leadId}?notice=${encodeURIComponent("Offer saved on the lead")}` : `/tools/offer?lead=${p.leadId}&error=${encodeURIComponent(r.error)}`);
}
