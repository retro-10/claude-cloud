"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { bulkAssign, bulkCadence, bulkChangeStage, BULK_MAX } from "@/lib/bulk";
import { applyCadence, cancelFollowUp, completeFollowUp, createFollowUp, rescheduleFollowUp } from "@/lib/followups";
import { logActivity } from "@/lib/leads";
import { requireCan } from "@/lib/server-auth";
import { followUpDue } from "@/lib/time";

const id = z.coerce.number().int().positive();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const kinds = z.enum(["whatsapp", "call", "instagram", "linkedin", "email", "other"]);

function refresh(leadId?: number) {
  revalidatePath("/");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function addFollowUpAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z
    .object({ id, date: ymd, kind: kinds.default("whatsapp"), note: z.string().max(2000).optional() })
    .parse(Object.fromEntries(form));
  const due = followUpDue(p.date);
  if (!due) return;
  await createFollowUp(db, { leadId: p.id, dueAt: due, kind: p.kind, note: p.note }, user.id);
  refresh(p.id);
}

export async function completeFollowUpAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ id, leadId: id }).parse(Object.fromEntries(form));
  await completeFollowUp(db, p.id, user.id);
  refresh(p.leadId);
}

export async function rescheduleFollowUpAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ id, leadId: id, date: ymd }).parse(Object.fromEntries(form));
  const due = followUpDue(p.date);
  if (due) await rescheduleFollowUp(db, p.id, due, user.id);
  refresh(p.leadId);
}

export async function cancelFollowUpAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ id, leadId: id }).parse(Object.fromEntries(form));
  await cancelFollowUp(db, p.id, user.id);
  refresh(p.leadId);
}

export async function applyCadenceAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ leadId: id, templateId: id }).parse(Object.fromEntries(form));
  const r = await applyCadence(db, p, user.id);
  refresh(p.leadId);
  if (!r.ok) {
    const msg = {
      not_found: "Lead or template not found",
      closed: "Lead is already won or lost",
      already_applied: "That cadence is already running",
      empty_template: "Template has no steps",
    }[r.error];
    redirect(`/leads/${p.leadId}?error=${encodeURIComponent(msg)}`);
  }
}

// One-click logging from the Today view: "I sent a WhatsApp" / "they replied".
export async function quickLogAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ leadId: id, direction: z.enum(["out", "in"]) }).parse(Object.fromEntries(form));
  await logActivity(db, { leadId: p.leadId, type: "whatsapp", direction: p.direction }, user.id);
  refresh(p.leadId);
}

const bulkSchema = z.object({
  op: z.enum(["stage", "owner", "cadence"]),
  stage: z.string().max(50).optional(),
  lostReasonId: z.string().optional(),
  ownerId: z.string().optional(),
  templateId: z.string().optional(),
});

const back = (msg: string) => redirect(`/leads?notice=${encodeURIComponent(msg)}`);

export async function bulkAction(form: FormData) {
  const user = await requireCan("lead:write");
  const ids = form.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) back("Select at least one lead.");
  if (ids.length > BULK_MAX) back(`Select at most ${BULK_MAX} leads at a time.`);
  const p = bulkSchema.parse(Object.fromEntries(form));

  let res, label: string;
  if (p.op === "stage") {
    if (!p.stage) back("Choose a stage.");
    res = await bulkChangeStage(db, ids, p.stage!, user.id, p.lostReasonId ? Number(p.lostReasonId) : null);
    label = "Moved";
  } else if (p.op === "owner") {
    res = await bulkAssign(db, ids, p.ownerId ? Number(p.ownerId) : null, user.id);
    label = "Assigned";
  } else {
    if (!p.templateId) back("Choose a cadence.");
    res = await bulkCadence(db, ids, Number(p.templateId), user.id);
    label = "Cadence added to";
  }
  revalidatePath("/leads");
  back(`${label} ${res.done} lead${res.done === 1 ? "" : "s"}${res.skipped ? `, skipped ${res.skipped} (${res.reasons.join("; ")})` : ""}.`);
}
