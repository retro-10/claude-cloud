"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  addDecision,
  cancelRun,
  closeDecision,
  deleteResponsibility,
  deleteSop,
  parseSteps,
  saveMeeting,
  saveResponsibility,
  saveSop,
  startRun,
  tickStep,
} from "@/lib/operations";
import { can } from "@/lib/rbac";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate, followUpDue } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const id = z.coerce.number().int().positive();
const optDay = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  revalidatePath("/team", "layout");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

// ---------------- responsibilities ----------------

export async function saveResponsibilityAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const p = z
    .object({ id: optId, area: z.string().max(400), cadence: z.string().max(60).optional(), responsibleId: optId, accountableId: optId, consulted: z.string().max(600).optional(), informed: z.string().max(600).optional(), notes: z.string().max(4000).optional() })
    .parse(Object.fromEntries(form));
  done("/team", await saveResponsibility(db, p.id, p, user.id), p.id ? "Saved" : "Added");
}

export async function deleteResponsibilityAction(form: FormData) {
  const user = await requireCan("ops:manage");
  await deleteResponsibility(db, id.parse(form.get("id")), user.id);
  done("/team", { ok: true }, "Removed");
}

// ---------------- playbooks and checklists ----------------

export async function saveSopAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const p = z.object({ id: optId, title: z.string().max(400), area: z.string().max(120).optional(), purpose: z.string().max(4000).optional(), steps: z.string().max(20000) }).parse(Object.fromEntries(form));
  const back = p.id ? `/team/sops/${p.id}` : "/team/sops";
  const steps = parseSteps(p.steps);
  if (typeof steps === "string") done(back, { ok: false, error: steps }, "");
  const r = await saveSop(db, p.id, { ...p, steps }, user.id);
  done(r.ok ? `/team/sops/${r.id}` : back, r, p.id ? "Playbook saved" : "Playbook added");
}

export async function deleteSopAction(form: FormData) {
  const user = await requireCan("ops:manage");
  await deleteSop(db, id.parse(form.get("id")), user.id);
  done("/team/sops", { ok: true }, "Playbook removed");
}

export async function startRunAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z.object({ sopId: id, title: z.string().max(400).optional(), assigneeId: optId, cohortId: optId, leadId: optId, due: optDay }).parse(Object.fromEntries(form));
  const r = await startRun(db, p.sopId, { ...p, dueAt: p.due ? followUpDue(p.due) : null }, user.id);
  done(r.ok ? `/team/runs/${r.id}` : safePath(form.get("back"), `/team/sops/${p.sopId}`), r, "Checklist started");
}

export async function tickStepAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z.object({ id, index: z.coerce.number().int().min(0), done: z.enum(["1", "0"]) }).parse(Object.fromEntries(form));
  const r = await tickStep(db, p.id, p.index, p.done === "1", user.id);
  done(`/team/runs/${p.id}`, r, r.ok && r.complete ? "All done: checklist complete" : "Saved");
}

export async function cancelRunAction(form: FormData) {
  const user = await requireCan("task:write");
  const runId = id.parse(form.get("id"));
  await cancelRun(db, runId, user.id);
  done("/team/runs", { ok: true }, "Checklist cancelled");
}

// ---------------- meetings and decisions ----------------

export async function saveMeetingAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const p = z.object({ id: optId, title: z.string().max(400), heldAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), attendees: z.string().max(1000).optional(), agenda: z.string().max(10000).optional(), notes: z.string().max(30000).optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) done("/team/meetings", { ok: false, error: "Pick the date and time" }, "");
  const r = await saveMeeting(db, p.data.id, { ...p.data, heldAt: cairoLocalToDate(p.data.heldAt)! }, user.id);
  done(r.ok ? `/team/meetings/${r.id}` : "/team/meetings", r, p.data.id ? "Meeting saved" : "Meeting added");
}

export async function addDecisionAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const p = z.object({ meetingId: optId, title: z.string().max(600), detail: z.string().max(8000).optional(), ownerId: optId, due: optDay }).parse(Object.fromEntries(form));
  const r = await addDecision(db, { ...p, dueAt: p.due ? followUpDue(p.due) : null }, user.id);
  done(safePath(form.get("back"), "/team/decisions"), r, "Decision logged");
}

export async function closeDecisionAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z.object({ id, status: z.enum(["done", "dropped", "open"]), outcome: z.string().max(4000).optional() }).parse(Object.fromEntries(form));
  const r = await closeDecision(db, p.id, p.status, p.outcome ?? null, { id: user.id, canManage: can(user.role, "ops:manage") });
  done(safePath(form.get("back"), "/team/decisions"), r, p.status === "open" ? "Reopened" : p.status === "done" ? "Marked done" : "Dropped");
}
