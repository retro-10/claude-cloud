import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { cohorts, leads, tasks, users } from "@/db/schema";
import { audit } from "./audit";
import { startOfCairoDay, startOfNextCairoDay } from "./time";

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskInput = {
  title: string;
  notes?: string | null;
  priority?: TaskPriority;
  assigneeId?: number | null;
  dueAt?: Date | null;
  leadId?: number | null;
  cohortId?: number | null;
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

async function checkLinks(db: Db, input: Pick<TaskInput, "assigneeId" | "leadId" | "cohortId">): Promise<string | null> {
  if (input.assigneeId) {
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, input.assigneeId));
    if (!u?.active) return "Pick an active team member";
  }
  if (input.leadId) {
    const [l] = await db.select({ deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, input.leadId));
    if (!l || l.deletedAt) return "That lead no longer exists";
  }
  if (input.cohortId) {
    const [c] = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, input.cohortId));
    if (!c) return "That batch no longer exists";
  }
  return null;
}

export async function createTask(db: Db, input: TaskInput, userId: number | null): Promise<Result<{ id: number }>> {
  const title = clean(input.title);
  if (!title) return { ok: false, error: "Give the task a title" };
  if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters" };
  const problem = await checkLinks(db, input);
  if (problem) return { ok: false, error: problem };
  const [row] = await db
    .insert(tasks)
    .values({
      title,
      notes: clean(input.notes),
      priority: input.priority ?? "normal",
      assigneeId: input.assigneeId === undefined ? userId : input.assigneeId, // null = "Nobody yet"
      dueAt: input.dueAt ?? null,
      leadId: input.leadId ?? null,
      cohortId: input.cohortId ?? null,
      createdBy: userId,
    })
    .returning({ id: tasks.id });
  await audit(db, { userId, entity: "task", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

export async function updateTask(db: Db, id: number, patch: Partial<TaskInput>, userId: number | null): Promise<Result> {
  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    const title = clean(patch.title);
    if (!title) return { ok: false, error: "Give the task a title" };
    if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters" };
    set.title = title;
  }
  if (patch.notes !== undefined) set.notes = clean(patch.notes);
  if (patch.priority !== undefined) set.priority = patch.priority;
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.leadId !== undefined) set.leadId = patch.leadId;
  if (patch.cohortId !== undefined) set.cohortId = patch.cohortId;
  const problem = await checkLinks(db, patch);
  if (problem) return { ok: false, error: problem };
  const rows = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning({ id: tasks.id });
  if (!rows.length) return { ok: false, error: "Task not found" };
  await audit(db, { userId, entity: "task", entityId: id, action: "update", diff: { fields: Object.keys(set).filter((k) => k !== "updatedAt") } });
  return { ok: true };
}

/** done: mark finished · reopen: back to open · cancel: dropped, kept for the record. */
export async function setTaskState(db: Db, id: number, state: "done" | "reopen" | "cancel", userId: number | null): Promise<boolean> {
  const now = new Date();
  const open = and(eq(tasks.id, id), isNull(tasks.doneAt), isNull(tasks.cancelledAt));
  const rows =
    state === "done"
      ? await db.update(tasks).set({ doneAt: now, doneBy: userId, updatedAt: now }).where(open).returning({ id: tasks.id })
      : state === "cancel"
        ? await db.update(tasks).set({ cancelledAt: now, updatedAt: now }).where(open).returning({ id: tasks.id })
        : await db.update(tasks).set({ doneAt: null, doneBy: null, cancelledAt: null, updatedAt: now }).where(eq(tasks.id, id)).returning({ id: tasks.id });
  if (rows.length) await audit(db, { userId, entity: "task", entityId: id, action: state });
  return rows.length > 0;
}

export type TaskFilter = {
  assigneeId?: number | "none";
  leadId?: number;
  cohortId?: number;
  status?: "open" | "done" | "all";
  due?: "overdue" | "today" | "week" | "none";
};

export type TaskRow = {
  id: number;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  dueAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  assigneeId: number | null;
  assignee: string | null;
  createdByName: string | null;
  leadId: number | null;
  leadName: string | null;
  cohortId: number | null;
  cohortName: string | null;
  overdue: boolean;
};

const PRIORITY_ORDER = sql`case ${tasks.priority} when 'high' then 0 when 'normal' then 1 else 2 end`;

export async function listTasks(db: Db, f: TaskFilter = {}, now = new Date(), limit = 300): Promise<TaskRow[]> {
  const creator = alias(users, "creator");
  const where: (SQL | undefined)[] = [];
  const status = f.status ?? "open";
  if (status === "open") where.push(isNull(tasks.doneAt), isNull(tasks.cancelledAt));
  if (status === "done") where.push(isNotNull(tasks.doneAt));
  if (f.assigneeId === "none") where.push(isNull(tasks.assigneeId));
  else if (f.assigneeId) where.push(eq(tasks.assigneeId, f.assigneeId));
  if (f.leadId) where.push(eq(tasks.leadId, f.leadId));
  if (f.cohortId) where.push(eq(tasks.cohortId, f.cohortId));
  const today = startOfCairoDay(now);
  const tomorrow = startOfNextCairoDay(now);
  if (f.due === "overdue") where.push(sql`${tasks.dueAt} < ${today.toISOString()}::timestamptz`);
  if (f.due === "today") where.push(sql`${tasks.dueAt} < ${tomorrow.toISOString()}::timestamptz`);
  if (f.due === "week") where.push(sql`${tasks.dueAt} < ${new Date(tomorrow.getTime() + 6 * 86_400_000).toISOString()}::timestamptz`);
  if (f.due === "none") where.push(isNull(tasks.dueAt));

  const rows = await db
    .select({
      t: tasks,
      assignee: users.name,
      createdByName: creator.name,
      leadName: leads.fullName,
      cohortName: cohorts.name,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .leftJoin(cohorts, eq(cohorts.id, tasks.cohortId))
    .where(and(...where))
    .orderBy(
      ...(status === "done"
        ? [desc(tasks.doneAt)]
        : [sql`${tasks.dueAt} asc nulls last`, asc(PRIORITY_ORDER), asc(tasks.id)]),
    )
    .limit(limit);
  return rows.map(({ t, assignee, createdByName, leadName, cohortName }) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    priority: t.priority,
    dueAt: t.dueAt,
    doneAt: t.doneAt,
    cancelledAt: t.cancelledAt,
    createdAt: t.createdAt,
    assigneeId: t.assigneeId,
    assignee,
    createdByName,
    leadId: t.leadId,
    leadName,
    cohortId: t.cohortId,
    cohortName,
    overdue: !t.doneAt && !t.cancelledAt && !!t.dueAt && t.dueAt < today,
  }));
}

/** Open tasks for the sidebar and the Command centre: mine, mine overdue, and everyone's overdue. */
export async function taskCounts(db: Db, userId: number, now = new Date()) {
  const today = startOfCairoDay(now).toISOString();
  const [r] = await db.execute<{ mine: number; mine_overdue: number; overdue: number; unassigned: number }>(sql`
    select count(*) filter (where assignee_id = ${userId})::int as mine,
           count(*) filter (where assignee_id = ${userId} and due_at < ${today}::timestamptz)::int as mine_overdue,
           count(*) filter (where due_at < ${today}::timestamptz)::int as overdue,
           count(*) filter (where assignee_id is null)::int as unassigned
    from tasks where done_at is null and cancelled_at is null`);
  return { mine: Number(r.mine), mineOverdue: Number(r.mine_overdue), overdue: Number(r.overdue), unassigned: Number(r.unassigned) };
}
