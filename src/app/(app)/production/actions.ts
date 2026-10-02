"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  CLIENT_KIND,
  assignCase,
  cancelCase,
  createCase,
  deliverCase,
  parseChecklist,
  reviewQc,
  saveCaseType,
  saveClient,
  sendToQc,
  startCase,
  updateCaseDetails,
} from "@/lib/production";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const id = z.coerce.number().int().positive();
const int = z.coerce.number().int();
const local = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable());

function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  revalidatePath("/production");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

// ---------------- clients and the price list (owners) ----------------

export async function saveClientAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z
    .object({
      id: optId,
      name: z.string().max(400),
      kind: z.enum(Object.keys(CLIENT_KIND) as [keyof typeof CLIENT_KIND]),
      contactName: z.string().max(400).optional(),
      phone: z.string().max(60).optional(),
      email: z.string().max(300).optional(),
      address: z.string().max(1000).optional(),
      discountPct: int,
      paymentTermsDays: int,
      notes: z.string().max(4000).optional(),
      active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  const back = safePath(form.get("back"), "/production/clients");
  if (!p.success) done(back, { ok: false, error: "Check the discount and payment terms" }, "");
  const r = await saveClient(db, p.data.id, { ...p.data, active: p.data.id ? p.data.active === "on" : true }, user.id);
  done(r.ok ? `/production/clients/${r.id}` : back, r, p.data.id ? "Client saved" : "Client added");
}

export async function saveCaseTypeAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z
    .object({
      id: optId,
      name: z.string().max(200),
      unitPriceEgp: int,
      designerPayEgp: int,
      standardDays: int,
      rushDays: int,
      rushSurchargePct: int,
      qcChecklist: z.string().max(4000).optional(),
      active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  const back = "/production/prices";
  if (!p.success) done(back, { ok: false, error: "Prices, pay and days are whole numbers" }, "");
  const list = parseChecklist(p.data.qcChecklist ?? "");
  if (typeof list === "string") done(back, { ok: false, error: list }, "");
  const r = await saveCaseType(db, p.data.id, { ...p.data, qcChecklist: list, active: p.data.id ? p.data.active === "on" : true }, user.id);
  done(back, r, p.data.id ? "Case type saved" : "Case type added");
}

// ---------------- cases ----------------

export async function createCaseAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z
    .object({
      clientId: id,
      caseTypeId: id,
      reference: z.string().max(300).optional(),
      units: int,
      rush: z.string().optional(),
      receivedAt: local,
      dueAt: local,
      designerId: optId,
      notes: z.string().max(4000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  const back = safePath(form.get("back"), "/production");
  if (!p.success) done(back, { ok: false, error: "Choose the client and case type, and the number of units" }, "");
  const r = await createCase(
    db,
    {
      ...p.data,
      rush: p.data.rush === "on",
      receivedAt: p.data.receivedAt ? cairoLocalToDate(p.data.receivedAt)! : undefined,
      dueAt: p.data.dueAt ? cairoLocalToDate(p.data.dueAt) : null,
    },
    user.id,
  );
  done(r.ok ? `/production/cases/${r.id}` : back, r, "Case taken in");
}

export async function updateCaseAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z.object({ id, reference: z.string().max(300).optional(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), notes: z.string().max(4000).optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) done(`/production/cases/${form.get("id")}`, { ok: false, error: "Pick the due date and time" }, "");
  const r = await updateCaseDetails(db, p.data.id, { ...p.data, dueAt: cairoLocalToDate(p.data.dueAt)! }, user.id);
  done(`/production/cases/${p.data.id}`, r, "Case saved");
}

export async function assignCaseAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z.object({ id, designerId: optId }).parse(Object.fromEntries(form));
  done(`/production/cases/${p.id}`, await assignCase(db, p.id, p.designerId, user.id), p.designerId ? "Assigned" : "Unassigned");
}

export async function startCaseAction(form: FormData) {
  const user = await requireCan("production:work");
  const caseId = id.parse(form.get("id"));
  done(`/production/cases/${caseId}`, await startCase(db, caseId, user), "Started");
}

export async function sendToQcAction(form: FormData) {
  const user = await requireCan("production:work");
  const caseId = id.parse(form.get("id"));
  done(`/production/cases/${caseId}`, await sendToQc(db, caseId, user), "Sent to QC");
}

// The checklist posts qc-0 … qc-n = "on" for each item that is right.
export async function reviewQcAction(form: FormData) {
  const user = await requireCan("production:manage");
  const caseId = id.parse(form.get("id"));
  const count = z.coerce.number().int().min(0).max(15).parse(form.get("count"));
  const ticked = Array.from({ length: count }, (_, i) => form.get(`qc-${i}`) === "on");
  const r = await reviewQc(db, caseId, ticked, String(form.get("note") ?? ""), user.id);
  done(`/production/cases/${caseId}`, r, r.ok && r.passed ? "QC passed: ready to deliver" : "Sent back to the designer");
}

export async function deliverCaseAction(form: FormData) {
  const user = await requireCan("production:manage");
  const caseId = id.parse(form.get("id"));
  done(`/production/cases/${caseId}`, await deliverCase(db, caseId, user.id), "Delivered");
}

export async function cancelCaseAction(form: FormData) {
  const user = await requireCan("production:manage");
  const p = z.object({ id, reason: z.string().max(400) }).parse(Object.fromEntries(form));
  done(`/production/cases/${p.id}`, await cancelCase(db, p.id, p.reason, user.id), "Case cancelled");
}
