"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { REWARD_STATUS, decideReward, ensureReferralCode, setReferrer, type RewardStatus } from "@/lib/referrals";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const back = (path: string, r: { ok: true } | { ok: false; error: string }, notice: string) =>
  redirect(r.ok ? `${path}?notice=${encodeURIComponent(notice)}` : `${path}?error=${encodeURIComponent(r.error)}`);

export async function makeReferralCodeAction(form: FormData) {
  await requireCan("growth:write");
  const leadId = id.parse(form.get("leadId"));
  const code = await ensureReferralCode(db, leadId);
  revalidatePath(`/leads/${leadId}`);
  back(`/leads/${leadId}`, code ? { ok: true } : { ok: false, error: "Could not make a code" }, "Referral link ready");
}

// "Who referred them": by the referrer's WhatsApp number; an empty number clears it.
export async function setReferrerAction(form: FormData) {
  const user = await requireCan("lead:write");
  const leadId = id.parse(form.get("leadId"));
  const raw = String(form.get("phone") ?? "").trim();
  let referrerId: number | null = null;
  if (raw) {
    const phone = normalizePhone(raw);
    const [r] = phone ? await db.select({ id: leads.id }).from(leads).where(eq(leads.phoneWhatsapp, phone)) : [];
    if (!r) back(`/leads/${leadId}`, { ok: false, error: "No lead with that number" }, "");
    referrerId = r.id;
  }
  const r = await setReferrer(db, leadId, referrerId, user.id);
  revalidatePath(`/leads/${leadId}`);
  back(`/leads/${leadId}`, r, referrerId ? "Referrer saved" : "Referrer cleared");
}

export async function decideRewardAction(form: FormData) {
  const user = await requireCan("payment:write");
  const p = z
    .object({
      id,
      status: z.enum(Object.keys(REWARD_STATUS) as [RewardStatus]),
      amountEgp: z.preprocess((v) => (v === "" || v == null ? null : typeof v === "string" ? v.replace(/[,\s]/g, "") : v), z.coerce.number().int().positive().nullable()),
      note: z.string().max(1000).optional(),
    })
    .parse(Object.fromEntries(form));
  const r = await decideReward(db, p.id, p, user.id);
  revalidatePath("/growth/referrals");
  back("/growth/referrals", r, `Reward ${REWARD_STATUS[p.status].toLowerCase()}`);
}
