"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { archiveDoc, archiveList, archiveSpace, createStarterSpaces, moveTask, saveDoc, saveList, saveSpace } from "@/lib/hq";
import { markAllRead, setRead } from "@/lib/notifications";
import { safePath } from "@/lib/safe-path";
import { requireCan, requireUser } from "@/lib/server-auth";
import { TASK_PRIORITIES, createTask, updateTask } from "@/lib/tasks";
import { followUpDue } from "@/lib/time";

const id = z.coerce.number().int().positive();
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const ymd = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

// Forms send back where they came from; the result shows there as a notice or an error.
function done(form: FormData, result: { ok: true } | { ok: false; error: string }, notice: string, to?: string) {
  const back = to ?? safePath(form.get("back"), "/hq");
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(result.ok ? `${back}${sep}notice=${encodeURIComponent(notice)}` : `${back}${sep}error=${encodeURIComponent(result.error)}`);
}

// ---------------- spaces and lists ----------------

export async function starterSpacesAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const r = await createStarterSpaces(db, user.id);
  done(form, r, "HQ is set up: five spaces, ready to rename");
}

/** The status editor posts parallel arrays: one row per status. */
function statusesFrom(form: FormData) {
  const labels = form.getAll("status_label").map(String);
  const groups = form.getAll("status_group").map(String);
  const colors = form.getAll("status_color").map(String);
  const keys = form.getAll("status_key").map(String);
  return labels.slice(0, 20).map((label, i) => ({ label, group: groups[i] ?? "todo", color: colors[i], key: keys[i] || undefined }));
}

export async function saveSpaceAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const spaceId = optId.parse(form.get("id"));
  const p = z.object({ name: text(200), description: text(2000), color: text(20), icon: text(30) }).parse(Object.fromEntries(form));
  const statuses = statusesFrom(form);
  const r = await saveSpace(db, spaceId, { ...p, statuses: statuses.length ? statuses : undefined }, user.id);
  done(form, r, spaceId ? "Space saved" : "Space created", r.ok && !spaceId ? `/spaces/${r.id}` : undefined);
}

export async function archiveSpaceAction(form: FormData) {
  const user = await requireCan("ops:manage");
  const r = await archiveSpace(db, id.parse(form.get("id")), user.id);
  done(form, r, "Space archived", r.ok ? "/hq" : undefined);
}

export async function saveListAction(form: FormData) {
  const user = await requireCan("task:write");
  const listId = optId.parse(form.get("id"));
  const p = z.object({ spaceId: id, name: text(200), description: text(2000) }).parse(Object.fromEntries(form));
  const r = await saveList(db, listId, p, user.id);
  done(form, r, listId ? "List saved" : "List added", r.ok && !listId ? `/spaces/${p.spaceId}?list=${r.id}` : undefined);
}

export async function archiveListAction(form: FormData) {
  const user = await requireCan("task:write");
  const r = await archiveList(db, id.parse(form.get("id")), user.id);
  done(form, r, "List archived");
}

// ---------------- tasks ----------------

const taskFields = z.object({
  title: text(400),
  listId: optId,
  parentId: optId,
  status: z.preprocess((v) => (v === "" || v == null ? null : v), z.string().max(30).nullable()),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assignee: z.preprocess((v) => (v == null ? "me" : v), z.string()),
  due: ymd,
});

/** The inline "+ Add task" row of every view: it inherits the list, status and date of the place it was typed in. */
export async function quickTaskAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = taskFields.parse(Object.fromEntries(form));
  const assigneeId = p.assignee === "me" ? user.id : p.assignee === "" ? null : id.parse(p.assignee);
  const r = await createTask(
    db,
    { title: p.title, listId: p.listId, parentId: p.parentId, status: p.status, priority: p.priority, assigneeId, dueAt: p.due ? followUpDue(p.due) : null },
    user.id,
  );
  done(form, r, "Task added");
}

/** Drag and drop and the status pickers call this directly. */
export async function moveTaskAction(input: { id: number; status?: string; listId?: number; position?: number }) {
  const user = await requireCan("task:write");
  const p = z
    .object({ id, status: z.string().max(30).optional(), listId: id.optional(), position: z.number().finite().optional() })
    .parse(input);
  const r = await moveTask(db, p.id, p, user.id);
  revalidatePath("/", "layout");
  return r;
}

export async function moveTaskFormAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z.object({ id, status: z.string().max(30) }).parse({ id: form.get("id"), status: form.get("status") });
  const r = await moveTask(db, p.id, { status: p.status }, user.id);
  done(form, r, "Status changed");
}

/** The task page's details form. Fields that are not on the form are left alone. */
export async function saveTaskDetailsAction(form: FormData) {
  const user = await requireCan("task:write");
  const taskId = id.parse(form.get("id"));
  const p = z
    .object({
      title: text(400),
      notes: text(8000),
      priority: z.enum(TASK_PRIORITIES),
      assigneeId: optId,
      start: ymd,
      due: ymd,
      tags: text(400),
    })
    .parse(Object.fromEntries(form));
  const r = await updateTask(
    db,
    taskId,
    {
      title: p.title,
      notes: p.notes,
      priority: p.priority,
      assigneeId: p.assigneeId,
      startAt: p.start ? followUpDue(p.start) : null,
      dueAt: p.due ? followUpDue(p.due) : null,
      tags: p.tags.split(","),
    },
    user.id,
  );
  if (r.ok) {
    const listId = optId.parse(form.get("listId"));
    const status = form.get("status");
    if (listId || status) {
      let m = await moveTask(db, taskId, { listId: listId ?? undefined, status: typeof status === "string" && status ? status : undefined }, user.id);
      // moved to a space with other statuses: keep how far along it is by group, not by name
      if (!m.ok && listId) m = await moveTask(db, taskId, { listId }, user.id);
      if (!m.ok) return done(form, m, "");
    }
  }
  done(form, r, "Task saved");
}

// ---------------- docs ----------------

export async function saveDocAction(form: FormData) {
  const user = await requireCan("task:write");
  const docId = optId.parse(form.get("id"));
  const p = z
    .object({ title: text(400), body: text(100_000), spaceId: optId, parentId: optId, wiki: z.preprocess((v) => v === "on" || v === "true", z.boolean()) })
    .parse(Object.fromEntries(form));
  const r = await saveDoc(db, docId, p, user.id);
  done(form, r, docId ? "Doc saved" : "Doc created", r.ok ? `/docs/${r.id}` : undefined);
}

export async function archiveDocAction(form: FormData) {
  const user = await requireCan("task:write");
  const r = await archiveDoc(db, id.parse(form.get("id")), user.id);
  done(form, r, "Doc archived", r.ok ? "/docs" : undefined);
}

// ---------------- inbox ----------------

export async function inboxReadAction(form: FormData) {
  const user = await requireUser();
  const p = z.object({ id, read: z.enum(["1", "0"]) }).parse({ id: form.get("id"), read: form.get("read") });
  const ok = await setRead(db, user.id, p.id, p.read === "1");
  done(form, ok ? { ok: true } : { ok: false, error: "That notification is gone" }, p.read === "1" ? "Cleared" : "Moved back to New");
}

export async function inboxClearAllAction(form: FormData) {
  const user = await requireUser();
  await markAllRead(db, user.id);
  done(form, { ok: true }, "Inbox cleared");
}

/** One field changed in place from the Table view: priority or assignee. */
export async function patchTaskAction(form: FormData) {
  const user = await requireCan("task:write");
  const p = z
    .object({ id, field: z.enum(["priority", "assignee"]), value: z.string().max(20) })
    .parse({ id: form.get("id"), field: form.get("field"), value: form.get("value") });
  const patch =
    p.field === "priority"
      ? { priority: z.enum(TASK_PRIORITIES).parse(p.value) }
      : { assigneeId: p.value === "" ? null : id.parse(p.value) };
  const r = await updateTask(db, p.id, patch, user.id);
  done(form, r, "Saved");
}
