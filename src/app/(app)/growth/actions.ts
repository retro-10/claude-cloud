"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUS, saveCampaign, type CampaignKind, type CampaignStatus } from "@/lib/campaigns";
import { saveEntry } from "@/lib/finance";
import { saveForm } from "@/lib/lead-forms";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const optInt = z.preprocess((v) => blank(typeof v === "string" ? v.replace(/[,\s]/g, "") : v), z.coerce.number().int().min(0).nullable());
const optDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable());
const toDate = (s: string | null, hour = "12:00") => (s ? cairoLocalToDate(s.length === 10 ? `${s}T${hour}` : s) : null);

const go = (path: string, r: { ok: true } | { ok: false; error: string }, notice: string) =>
  redirect(r.ok ? `${path}?notice=${encodeURIComponent(notice)}` : `${path}?error=${encodeURIComponent(r.error)}`);

export async function saveCampaignAction(form: FormData) {
  const user = await requireCan("growth:write");
  const p = z
    .object({
      id: optId,
      label: z.string().max(200),
      kind: z.enum(Object.keys(CAMPAIGN_KINDS) as [CampaignKind]),
      status: z.enum(Object.keys(CAMPAIGN_STATUS) as [CampaignStatus]),
      sourceId: optId,
      startedAt: optDate,
      endsAt: optDate,
      eventAt: optDate,
      budgetEgp: optInt,
      slug: z.string().max(60).optional(),
      ownerId: optId,
      notes: z.string().max(4000).optional(),
    })
    .parse(Object.fromEntries(form));
  const r = await saveCampaign(
    db,
    p.id,
    { ...p, startedAt: toDate(p.startedAt, "00:00"), endsAt: toDate(p.endsAt, "23:59"), eventAt: toDate(p.eventAt) },
    user.id,
  );
  revalidatePath("/growth/campaigns");
  if (r.ok) go(`/growth/campaigns/${r.id}`, r, p.id ? "Campaign saved" : "Campaign created");
  else go(p.id ? `/growth/campaigns/${p.id}` : "/growth/campaigns", r, "");
}

// A marketing cost recorded from the campaign page: a ledger row tagged with the campaign (finance and owners).
export async function addCampaignCostAction(form: FormData) {
  const user = await requireCan("payment:write");
  const p = z
    .object({
      campaignId: z.coerce.number().int().positive(),
      entry: z.string().max(200),
      amountEgp: z.preprocess((v) => (typeof v === "string" ? v.replace(/[,\s]/g, "") : v), z.coerce.number().int().positive()),
      status: z.enum(["paid", "owed"]),
      date: optDate,
      category: z.string().max(80).default("Ads & promotion"),
    })
    .parse(Object.fromEntries(form));
  const r = await saveEntry(db, null, { entry: p.entry || "Campaign cost", amountEgp: p.amountEgp, section: "variable_costs", category: p.category, status: p.status, date: toDate(p.date), campaignId: p.campaignId }, user.id);
  revalidatePath(`/growth/campaigns/${p.campaignId}`);
  go(`/growth/campaigns/${p.campaignId}`, r, "Cost recorded in the ledger");
}

export async function saveFormAction(form: FormData) {
  const user = await requireCan("growth:write");
  const p = z
    .object({
      id: optId,
      slug: z.string().max(60),
      title: z.string().max(200),
      intro: z.string().max(4000).optional(),
      thankYou: z.string().max(2000).optional(),
      campaignId: optId,
      sourceId: optId,
    })
    .parse(Object.fromEntries(form));
  const on = (k: string) => form.get(k) === "on";
  const r = await saveForm(db, p.id, { ...p, askEmail: on("askEmail"), askCity: on("askCity"), askSegment: on("askSegment"), askTier: on("askTier"), active: on("active") }, user.id);
  revalidatePath("/growth/forms");
  go("/growth/forms", r, p.id ? "Form saved" : "Form created");
}
