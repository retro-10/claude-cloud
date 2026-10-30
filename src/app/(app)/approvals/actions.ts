"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { approvalLink, cancelRequest, decide, reply, submitRequest } from "@/lib/approvals";
import type { Result } from "@/lib/result";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));
const optInt = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().nullable());

function go(to: string, r: Result, notice: string): never {
  revalidatePath("/", "layout");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

export async function submitApprovalAction(form: FormData) {
  const user = await requireCan("approval:submit");
  const p = z
    .object({ type: text(20), title: text(200), details: text(4000), amountEgp: optInt, category: text(60), campaignId: optInt, startsOn: text(10), endsOn: text(10) })
    .parse(Object.fromEntries(form));
  const r = await submitRequest(db, user, { ...p, startsOn: p.startsOn || null, endsOn: p.endsOn || null });
  go(r.ok ? approvalLink(r.id) : `/approvals/new?type=${encodeURIComponent(p.type)}`, r, "Sent for approval");
}

/** Approve, reject or ask a question. Whether this person may decide is checked against the request itself. */
export async function decideApprovalAction(form: FormData) {
  const user = await requireCan("approval:submit");
  const p = z.object({ id, decision: z.enum(["approve", "reject", "needs_info"]), note: text(2000) }).parse(Object.fromEntries(form));
  const r = await decide(db, user, p.id, p.decision, p.note);
  const notice = p.decision === "approve" ? "Approved" : p.decision === "reject" ? "Rejected" : "Question sent";
  go(safePath(form.get("back"), approvalLink(p.id)), r, notice);
}

export async function replyApprovalAction(form: FormData) {
  const user = await requireCan("approval:submit");
  const p = z.object({ id, note: text(2000) }).parse(Object.fromEntries(form));
  go(approvalLink(p.id), await reply(db, user, p.id, p.note), "Answer sent; it is back with the approvers");
}

export async function cancelApprovalAction(form: FormData) {
  const user = await requireCan("approval:submit");
  const requestId = id.parse(form.get("id"));
  go(approvalLink(requestId), await cancelRequest(db, user, requestId), "Request withdrawn");
}
