"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leads, messageTemplates, savedViews } from "@/db/schema";
import { recordConsent, setDoNotContact, CONSENT_METHODS, type ConsentMethod } from "@/lib/consent";
import { requireCan, requireUser } from "@/lib/server-auth";
import {
  changeStage,
  closeLostReview,
  createLead,
  logActivity,
  reactivateLead,
  setDeleted,
  setTags,
  updateLead,
  updateOffer,
  type Duplicate,
} from "@/lib/leads";
import { VIEW_KEYS } from "@/lib/lead-list";
import { mergeLeads, undoMerge, MERGE_FIELDS } from "@/lib/merge";
import { markAllRead } from "@/lib/notifications";
import { phoneProblem } from "@/lib/phone";
import { addDaysYmd, cairoLocalToDate, cairoYmd, followUpDue } from "@/lib/time";
import { sql } from "drizzle-orm";

const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable());
const optStr = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max)).optional().transform((v) => v || null);
const optEnum = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(vals as unknown as [T[number], ...T[number][]]).nullable());

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"] as const;
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"] as const;

export type QuickAddState = { error?: string; duplicates?: Duplicate[]; soft?: boolean };

const quickAddSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200),
  phone: optStr(40),
  sourceId: optInt,
  city: optStr(100),
  allowNameMatch: z.string().optional(),
});

export async function quickAddLead(_prev: QuickAddState, form: FormData): Promise<QuickAddState> {
  const user = await requireCan("lead:write");
  const parsed = quickAddSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  const r = await createLead(db, { fullName: d.fullName, phone: d.phone, sourceId: d.sourceId, city: d.city }, user.id, {
    allowNameMatch: d.allowNameMatch === "1",
  });
  if (!r.ok) {
    if (r.error === "invalid_phone") return { error: phoneProblem(d.phone) ?? "That doesn't look like a phone number." };
    if (r.error === "possible_duplicate")
      return { error: "Someone with the same name in the same city already exists. Is it the same person?", duplicates: r.duplicates, soft: true };
    return { error: "This person already exists.", duplicates: r.duplicates };
  }
  revalidatePath("/", "layout");
  redirect(`/leads/${r.lead.id}`);
}

const leadSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: optStr(40),
  email: optStr(200).pipe(z.string().email().nullable()),
  city: optStr(100),
  segment: optEnum(SEGMENTS),
  sourceId: optInt,
  tierInterest: z.enum(TIERS),
  ownerId: optInt,
  notes: optStr(10_000),
});

export type FormResult = { error?: string };

export async function updateLeadAction(_prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireCan("lead:write");
  const id = Number(form.get("id"));
  const parsed = leadSchema.safeParse(Object.fromEntries(form));
  if (!Number.isInteger(id) || !parsed.success) return { error: "Check the fields and try again." };
  const bad = phoneProblem(parsed.data.phone);
  if (bad) return { error: bad };
  const r = await updateLead(db, id, parsed.data, user.id);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/leads/${id}`);
  return {};
}

const activitySchema = z.object({
  id: z.coerce.number().int().positive(),
  type: z.enum(["whatsapp", "call", "instagram", "linkedin", "email", "note", "consult"]),
  direction: z.enum(["out", "in", "internal"]),
  body: optStr(10_000),
});

export async function addActivity(form: FormData) {
  const user = await requireCan("lead:write");
  const p = activitySchema.parse(Object.fromEntries(form));
  // notes are always internal
  await logActivity(db, { leadId: p.id, type: p.type, direction: p.type === "note" ? "internal" : p.direction, body: p.body }, user.id);
  revalidatePath(`/leads/${p.id}`);
  revalidatePath("/", "layout");
}

export async function changeStageAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const stage = z.string().min(1).max(50).parse(form.get("stage"));
  const lostReasonId = optInt.parse(form.get("lostReasonId"));
  const r = await changeStage(db, id, stage, user.id, { lostReasonId });
  if (!r.ok) redirect(`/leads/${id}?error=${encodeURIComponent(r.error)}`);
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}`);
}

export async function deleteLeadAction(form: FormData) {
  const user = await requireCan("lead:delete");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  await setDeleted(db, id, true, user.id);
  redirect("/leads");
}

export async function restoreLeadAction(form: FormData) {
  const user = await requireCan("lead:delete");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  try {
    await setDeleted(db, id, false, user.id);
  } catch {
    redirect(`/leads/${id}?error=${encodeURIComponent("Another live lead already uses this email")}`);
  }
  redirect(`/leads/${id}`);
}

export async function saveViewAction(form: FormData) {
  const user = await requireCan("lead:write");
  const name = z.string().trim().min(1).max(60).parse(form.get("name"));
  const params = new URLSearchParams(String(form.get("query") ?? ""));
  const filters: Record<string, string> = {};
  for (const k of VIEW_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v.slice(0, 200);
  }
  await db.insert(savedViews).values({ userId: user.id, name, filters, shared: form.get("shared") === "on" });
  redirect(`/leads?${new URLSearchParams(filters).toString()}`);
}

export async function deleteViewAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  // owners may remove any view, others only their own
  await db.delete(savedViews).where(user.role === "owner" ? eq(savedViews.id, id) : and(eq(savedViews.id, id), eq(savedViews.userId, user.id)));
  redirect("/leads");
}

// ---- M2: the composer opened WhatsApp with a prefilled message; the user confirms it was sent ----

const sentSchema = z.object({
  leadId: z.number().int().positive(),
  templateId: z.number().int().positive().nullable(),
  body: z.string().trim().min(1).max(5000),
});

export async function logSentMessageAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireCan("lead:write");
  const p = sentSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Nothing to log" };
  const [lead] = await db.select({ dnc: leads.doNotContact }).from(leads).where(sql`${leads.id} = ${p.data.leadId}`);
  if (!lead) return { ok: false, error: "Lead not found" };
  if (lead.dnc) return { ok: false, error: "This lead is marked do-not-contact" };
  await logActivity(db, { leadId: p.data.leadId, type: "whatsapp", direction: "out", body: p.data.body, templateId: p.data.templateId }, user.id);
  if (p.data.templateId) {
    await db.update(messageTemplates).set({ usageCount: sql`${messageTemplates.usageCount} + 1` }).where(sql`${messageTemplates.id} = ${p.data.templateId}`);
  }
  revalidatePath(`/leads/${p.data.leadId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- offer details (exit criteria for Offer sent) ----

const back = (id: number, q: string) => redirect(`/leads/${id}?${q}`);

export async function updateOfferAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const tier = optEnum(["foundation", "freelance_ready", "production_partner"] as const).parse(form.get("offerTier"));
  const amount = z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(/[^\d]/g, ""))), z.number().int().nullable()).parse(form.get("offerAmountEgp"));
  const link = optStr(500).parse(form.get("offerPaymentLink") ?? undefined);
  const decision = String(form.get("decisionDueAt") ?? "");
  const r = await updateOffer(
    db,
    id,
    {
      offerTier: tier,
      offerAmountEgp: amount,
      offerPaymentLink: link,
      linkSent: form.get("linkSent") === "on",
      decisionDueAt: decision ? (cairoLocalToDate(decision.length === 10 ? `${decision}T12:00` : decision) ?? null) : null,
    },
    user.id,
  );
  revalidatePath(`/leads/${id}`);
  back(id, r.ok ? "notice=Offer+saved" : `error=${encodeURIComponent(r.error)}`);
}

// ---- tags, consent ----

export async function setTagsAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const raw = z.string().max(1000).parse(form.get("tags") ?? "");
  await setTags(db, id, raw.split(","), user.id);
  revalidatePath(`/leads/${id}`);
}

export async function consentAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const method = z.enum(Object.keys(CONSENT_METHODS) as [ConsentMethod, ...ConsentMethod[]]).parse(form.get("method"));
  await recordConsent(db, { leadId: id, granted: method !== "refused", method }, user.id);
  revalidatePath(`/leads/${id}`);
  back(id, "notice=Consent+recorded");
}

export async function doNotContactAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  await setDoNotContact(db, id, form.get("value") === "1", user.id);
  revalidatePath(`/leads/${id}`);
  back(id, form.get("value") === "1" ? "notice=Marked+do+not+contact" : "notice=Contact+allowed+again");
}

// ---- D3 merge and undo ----

export async function mergeAction(form: FormData) {
  const user = await requireCan("lead:write");
  const survivorId = z.coerce.number().int().positive().parse(form.get("survivorId"));
  const loserId = z.coerce.number().int().positive().parse(form.get("loserId"));
  const pick: Partial<Record<(typeof MERGE_FIELDS)[number], "survivor" | "loser">> = {};
  for (const f of MERGE_FIELDS) if (form.get(`pick_${f}`) === "loser") pick[f] = "loser";
  const r = await mergeLeads(db, { survivorId, loserId, pick, combineNotes: form.get("combineNotes") === "on" }, user.id);
  if (!r.ok) redirect(`/leads/merge?a=${survivorId}&b=${loserId}&error=${encodeURIComponent(r.error)}`);
  revalidatePath("/", "layout");
  redirect(`/leads/${survivorId}?notice=${encodeURIComponent("Merged. You can undo this for 7 days.")}`);
}

export async function undoMergeAction(form: FormData) {
  const user = await requireCan("lead:write");
  const mergeId = z.coerce.number().int().positive().parse(form.get("mergeId"));
  const leadId = z.coerce.number().int().positive().parse(form.get("leadId"));
  const r = await undoMerge(db, mergeId, user.id);
  revalidatePath("/", "layout");
  back(leadId, r.ok ? "notice=Merge+undone" : `error=${encodeURIComponent(r.error)}`);
}

// ---- P5 no-decision review ----

export async function closeReviewAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  await closeLostReview(db, id, user.id);
  revalidatePath("/", "layout");
  const to = String(form.get("back") ?? "");
  redirect(to.startsWith("/") && !to.startsWith("//") ? to : "/leads?view=no_decision_review");
}

export async function reactivateAction(form: FormData) {
  const user = await requireCan("lead:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const days = z.coerce.number().int().min(0).max(365).parse(form.get("days") ?? "7");
  const next = followUpDue(addDaysYmd(cairoYmd(new Date()), days))!;
  const r = await reactivateLead(db, id, next, user.id);
  revalidatePath("/", "layout");
  back(id, r.ok ? "notice=Reactivated+into+Nurture" : `error=${encodeURIComponent(r.error)}`);
}

// ---- N1 notifications (own only) ----

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await markAllRead(db, user.id);
  revalidatePath("/", "layout");
}
