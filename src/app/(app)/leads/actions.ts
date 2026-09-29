"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { requireCan } from "@/lib/server-auth";
import { changeStage, createLead, logActivity, setDeleted, updateLead, type Duplicate } from "@/lib/leads";
import { VIEW_KEYS } from "@/lib/lead-list";

const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable());
const optStr = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max)).optional().transform((v) => v || null);
const optEnum = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(vals as unknown as [T[number], ...T[number][]]).nullable());

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"] as const;
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"] as const;

export type QuickAddState = { error?: string; duplicates?: Duplicate[] };

const quickAddSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(200),
  phone: optStr(40),
  sourceId: optInt,
});

export async function quickAddLead(_prev: QuickAddState, form: FormData): Promise<QuickAddState> {
  const user = await requireCan("lead:write");
  const parsed = quickAddSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const r = await createLead(db, { fullName: parsed.data.fullName, phone: parsed.data.phone, sourceId: parsed.data.sourceId }, user.id);
  if (!r.ok) {
    return r.error === "invalid_phone"
      ? { error: "That doesn't look like a phone number." }
      : { error: "This person already exists.", duplicates: r.duplicates };
  }
  revalidatePath("/leads");
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
