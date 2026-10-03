"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { TASK_PRIORITIES, createTask, setTaskState, updateTask } from "@/lib/tasks";
import { followUpDue } from "@/lib/time";

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const ymd = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const fields = z.object({
  title: z.string().max(400),
  notes: z.string().max(4000).optional(),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeId: optId,
  due: ymd,
  leadId: optId,
  cohortId: optId,
});

// Forms send back where they came from (the lead, the batch, the task list); the result shows there.
function done(form: FormData, result: { ok: true } | { ok: false; error: string }, notice: string) {
  const back = safePath(form.get("back"), "/tasks");
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(result.ok ? `${back}${sep}notice=${encodeURIComponent(notice)}` : `${back}${sep}error=${encodeURIComponent(result.error)}`);
}

export async function createTaskAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = fields.parse(Object.fromEntries(form));
  const r = await createTask(db, { ...p, dueAt: p.due ? followUpDue(p.due) : null }, user.id);
  done(form, r, "Task added");
}

export async function updateTaskAction(form: FormData) {
  const user = await requireCan("task:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const p = fields.parse(Object.fromEntries(form));
  const r = await updateTask(db, id, { ...p, dueAt: p.due ? followUpDue(p.due) : null }, user.id);
  done(form, r, "Task saved");
}

export async function taskStateAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z.object({ id: z.coerce.number().int().positive(), state: z.enum(["done", "reopen", "cancel"]) }).parse({ id: form.get("id"), state: form.get("state") });
  const ok = await setTaskState(db, p.id, p.state, user.id);
  done(form, ok ? { ok: true } : { ok: false, error: "That task was already finished or removed" }, { done: "Done", reopen: "Reopened", cancel: "Task cancelled" }[p.state]);
}
