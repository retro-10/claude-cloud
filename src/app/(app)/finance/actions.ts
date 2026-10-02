"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { SECTIONS, deleteEntry, recordPayment, saveEntry, settleEntry, updateCandidate, type Section, type Status } from "@/lib/finance";
import { requireCan } from "@/lib/server-auth";
import { safePath } from "@/lib/safe-path";
import { cairoLocalToDate } from "@/lib/time";

const id = z.coerce.number().int().positive();
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const ymd = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
// whole EGP: "1,500" and "1 500 EGP" are fine; "1.5", "-3" or "" are refused
const egpInt = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.replace(/[,\s]|EGP/gi, "");
  return /^\d{1,9}$/.test(t) ? Number(t) : NaN;
}, z.number().int().nonnegative());
const day = (d: string | null) => (d ? cairoLocalToDate(`${d}T12:00`) : null);

// Back to where the form was, with a notice or an error. Only same-site paths.
function back(form: FormData, r: { ok: boolean; error?: string }, ok = "Saved"): never {
  const path = safePath(form.get("back"), "/finance");
  const sep = path.includes("?") ? "&" : "?";
  revalidatePath("/finance");
  revalidatePath("/cohorts", "layout");
  redirect(`${path}${sep}${r.ok ? `notice=${encodeURIComponent(ok)}` : `error=${encodeURIComponent(r.error ?? "Could not save")}`}`);
}

const entrySchema = z.object({
  entry: z.string().max(200),
  amountEgp: egpInt,
  date: ymd,
  section: z.enum(Object.keys(SECTIONS) as [Section, ...Section[]]),
  category: z.string().max(80),
  status: z.enum(["received", "expected", "paid", "owed", "cancelled"]),
  partner: z.string().max(40).optional(),
  fromTo: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  enrolmentId: optId,
  teamMemberId: optId,
});

export async function saveEntryAction(form: FormData) {
  const user = await requireCan("payment:write");
  const entryId = optId.parse(form.get("id"));
  const p = entrySchema.safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "Check the amount, section and status." });
  const d = p.data!;
  const r = await saveEntry(
    db,
    entryId,
    {
      ...d,
      status: d.status as Status,
      date: day(d.date),
      dateApproximate: form.get("dateApproximate") === "on",
      partner: d.partner || null,
    },
    user.id,
  );
  back(form, r, entryId ? "Entry updated" : "Entry added");
}

export async function settleEntryAction(form: FormData) {
  const user = await requireCan("payment:write");
  back(form, await settleEntry(db, id.parse(form.get("id")), user.id), "Marked as done");
}

export async function deleteEntryAction(form: FormData) {
  const user = await requireCan("payment:write");
  await deleteEntry(db, id.parse(form.get("id")), user.id);
  back(form, { ok: true }, "Entry deleted");
}

export async function recordPaymentAction(form: FormData) {
  const user = await requireCan("payment:write");
  const p = z
    .object({ enrolmentId: id, amountEgp: egpInt, date: ymd, status: z.enum(["received", "expected"]), reference: z.string().max(200).optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "Enter the amount in whole EGP." });
  const d = p.data!;
  const r = await recordPayment(db, { enrolmentId: d.enrolmentId, amountEgp: d.amountEgp, date: day(d.date), status: d.status, reference: d.reference }, user.id);
  back(form, r, d.status === "expected" ? "Installment scheduled" : "Payment recorded");
}

export async function updateCandidateAction(form: FormData) {
  const user = await requireCan("payment:write");
  const p = z
    .object({
      enrolmentId: id,
      tier: z.enum(["foundation", "freelance_ready", "production_partner"]),
      amountEgp: egpInt,
      discountEgp: egpInt,
      paymentPlan: z.enum(["one_time", "installments", "free_seat"]),
      finalInstalmentAt: ymd,
      status: z.enum(["active", "graduated", "dropped"]),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "Check the price and discount." });
  const d = p.data!;
  back(form, await updateCandidate(db, d.enrolmentId, { ...d, finalInstalmentAt: day(d.finalInstalmentAt) }, user.id), "Candidate updated");
}

// Settings: how net income is split. Owners only (it decides who gets what).
export async function saveSplitAction(form: FormData) {
  const user = await requireCan("settings:write");
  const names = form.getAll("partnerName").map(String);
  const pcts = form.getAll("partnerPct").map((v) => Number(v));
  const partners = names.map((name, i) => ({ name: name.trim(), pct: pcts[i] })).filter((p) => p.name);
  const r = await saveSettings(db, { financeSplit: { partners, capitalPct: Number(form.get("capitalPct")) } }, user.id);
  back(form, r.ok ? r : { ok: false, error: "The shares must be names with percentages that add up to 100 together with Capital." }, "Split saved");
}

export async function saveInvoiceDetailsAction(form: FormData) {
  const user = await requireCan("settings:write");
  const f = (k: string) => String(form.get(k) ?? "");
  const r = await saveSettings(
    db,
    { invoiceDetails: { legalName: f("legalName"), address: f("address"), taxId: f("taxId"), phone: f("phone"), email: f("email"), paymentInstructions: f("paymentInstructions"), footer: f("footer") } },
    user.id,
  );
  revalidatePath("/settings/finance");
  redirect(r.ok ? "/settings/finance?notice=Invoice+details+saved" : `/settings/finance?error=${encodeURIComponent("Give the business name; keep each field short")}`);
}
