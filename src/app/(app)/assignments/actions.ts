"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { enrolments } from "@/db/schema";
import { deleteAssignment, parseRubric, recordSubmission, reviewSubmission, saveAssignment } from "@/lib/assignments";
import { addAttachment } from "@/lib/attachments";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const id = z.coerce.number().int().positive();

function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  redirect(r.ok ? `${to}?notice=${encodeURIComponent(notice)}` : `${to}?error=${encodeURIComponent(r.error)}`);
}

export async function saveAssignmentAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z
    .object({
      id: optId,
      cohortId: id,
      title: z.string().max(400),
      brief: z.string().max(8000).optional(),
      dueAt: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable()),
      rubric: z.string().max(4000),
      passPct: z.coerce.number().int(),
    })
    .parse(Object.fromEntries(form));
  const back = p.id ? `/assignments/${p.id}` : "/assignments";
  const rubric = parseRubric(p.rubric);
  if (typeof rubric === "string") done(back, { ok: false, error: rubric }, "");
  const r = await saveAssignment(db, p.id, { ...p, rubric, dueAt: p.dueAt ? cairoLocalToDate(p.dueAt) : null }, user.id);
  revalidatePath("/assignments");
  done(r.ok ? `/assignments/${r.id}` : back, r, p.id ? "Assignment saved" : "Assignment added");
}

export async function deleteAssignmentAction(form: FormData) {
  const user = await requireCan("programme:write");
  await deleteAssignment(db, id.parse(form.get("id")), user.id);
  revalidatePath("/assignments");
  done("/assignments", { ok: true }, "Assignment removed");
}

// Staff record a submission the student sent another way (WhatsApp, Drive): the file goes on the student's lead.
export async function recordSubmissionAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z.object({ assignmentId: id, enrolmentId: id, link: z.string().max(600).optional(), note: z.string().max(2000).optional() }).parse({
    assignmentId: form.get("assignmentId"),
    enrolmentId: form.get("enrolmentId"),
    link: form.get("link") ?? undefined,
    note: form.get("note") ?? undefined,
  });
  const back = `/assignments/${p.assignmentId}`;
  let attachmentId: number | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size) {
    const [e] = await db.select({ leadId: enrolments.leadId }).from(enrolments).where(eq(enrolments.id, p.enrolmentId));
    if (!e) done(back, { ok: false, error: "Student not found" }, "");
    const a = await addAttachment(db, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { leadId: e.leadId, note: "Assignment submission" }, user.id);
    if (!a.ok) done(back, a, "");
    attachmentId = a.id;
  }
  const r = await recordSubmission(db, p.assignmentId, p.enrolmentId, { attachmentId, link: p.link, note: p.note }, { userId: user.id });
  revalidatePath(back);
  done(back, r, r.ok && r.attempt > 1 ? `Attempt ${r.attempt} recorded` : "Submission recorded");
}

// The rubric's scores arrive as score-0, score-1, … in the rubric's order.
export async function reviewSubmissionAction(form: FormData) {
  const user = await requireCan("programme:write");
  const submissionId = id.parse(form.get("submissionId"));
  const assignmentId = id.parse(form.get("assignmentId"));
  const scores = [...form.keys()]
    .filter((k) => /^score-\d+$/.test(k))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .map((k) => Number(String(form.get(k)).replace(",", ".")));
  const r = await reviewSubmission(db, submissionId, scores, String(form.get("feedback") ?? ""), user.id);
  revalidatePath(`/assignments/${assignmentId}`);
  done(`/assignments/${assignmentId}`, r, r.ok ? `Reviewed: ${r.totalPct}%, ${r.passed ? "passed" : "needs rework"}` : "");
}
