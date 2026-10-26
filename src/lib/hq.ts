import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { alias } from "drizzle-orm/pg-core";
import { auditLog, cohorts, docs, leads, spaces, taskLists, tasks, users, type SpaceStatus } from "@/db/schema";
import { audit } from "./audit";
import { type Result, clean } from "./result";
import { addDaysYmd, cairoYmd, startOfCairoDay, startOfNextCairoDay } from "./time";

// HQ: the company's work outside the sales pipeline, organised the way most work tools do it.
// Space (an area of the company) > List (a project or stream) > Task > Subtask, plus Docs.

export type { SpaceStatus };
export type StatusGroup = SpaceStatus["group"];
export const STATUS_GROUPS: { key: StatusGroup; label: string }[] = [
  { key: "todo", label: "Not started" },
  { key: "active", label: "In progress" },
  { key: "done", label: "Done" },
];

/** Colour names map to the theme tokens, so statuses and spaces stay legible in light and dark. */
export const COLORS = ["slate", "brand", "info", "ok", "warn", "danger", "pink", "teal"] as const;
export type Color = (typeof COLORS)[number];

export const SPACE_ICONS = ["layers", "leads", "cohorts", "sparkle", "target", "trend", "settings", "user", "calendar", "flag"] as const;

export const DEFAULT_STATUSES: SpaceStatus[] = [
  { key: "todo", label: "To do", color: "slate", group: "todo" },
  { key: "doing", label: "In progress", color: "brand", group: "active" },
  { key: "review", label: "Review", color: "warn", group: "active" },
  { key: "done", label: "Done", color: "ok", group: "done" },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30) || "status";

/** Checks a space's status list: 1 to 12, each named, at least one open and one done, keys stable and unique. */
export function checkStatuses(input: { key?: string; label: string; color?: string; group: string }[]): Result<{ statuses: SpaceStatus[] }> {
  const out: SpaceStatus[] = [];
  for (const s of input) {
    const label = clean(s.label, 40);
    if (!label) continue;
    if (!STATUS_GROUPS.some((g) => g.key === s.group)) return { ok: false, error: `Pick a group for "${label}"` };
    let key = s.key && /^[a-z0-9_]{1,30}$/.test(s.key) ? s.key : slug(label);
    while (out.some((o) => o.key === key)) key = `${key}_2`.slice(-30);
    out.push({ key, label, color: (COLORS as readonly string[]).includes(s.color ?? "") ? s.color! : "slate", group: s.group as StatusGroup });
  }
  if (!out.length) return { ok: false, error: "Add at least one status" };
  if (out.length > 12) return { ok: false, error: "Keep it to 12 statuses or fewer" };
  if (!out.some((s) => s.group !== "done")) return { ok: false, error: "Keep at least one open status (Not started or In progress)" };
  if (!out.some((s) => s.group === "done")) return { ok: false, error: "Keep at least one Done status" };
  // the order of the board is the order of the groups, then the order given
  const rank = { todo: 0, active: 1, done: 2 };
  return { ok: true, statuses: out.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.group] - rank[b.s.group] || a.i - b.i).map((x) => x.s) };
}

// ---------------- spaces and lists ----------------

export type SpaceTree = {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  statuses: SpaceStatus[];
  open: number;
  lists: { id: number; name: string; description: string | null; open: number }[];
};

/** Every active space with its lists and their open task counts, in sidebar order. */
export async function listSpaces(db: Db): Promise<SpaceTree[]> {
  const [rows, lists, counts] = await Promise.all([
    db.select().from(spaces).where(isNull(spaces.archivedAt)).orderBy(asc(spaces.position), asc(spaces.id)),
    db.select().from(taskLists).where(isNull(taskLists.archivedAt)).orderBy(asc(taskLists.position), asc(taskLists.id)),
    db
      .select({ listId: tasks.listId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(isNull(tasks.doneAt), isNull(tasks.cancelledAt), sql`${tasks.listId} is not null`))
      .groupBy(tasks.listId),
  ]);
  const open = new Map(counts.map((c) => [c.listId, Number(c.n)]));
  return rows.map((s) => {
    const ls = lists.filter((l) => l.spaceId === s.id).map((l) => ({ id: l.id, name: l.name, description: l.description, open: open.get(l.id) ?? 0 }));
    return { id: s.id, name: s.name, description: s.description, color: s.color, icon: s.icon, statuses: s.statuses, open: ls.reduce((a, l) => a + l.open, 0), lists: ls };
  });
}

export async function getSpace(db: Db, id: number) {
  const [s] = await db.select().from(spaces).where(and(eq(spaces.id, id), isNull(spaces.archivedAt)));
  return s ?? null;
}

export type SpaceInput = { name: string; description?: string | null; color?: string; icon?: string; statuses?: Parameters<typeof checkStatuses>[0] };

export async function saveSpace(db: Db, id: number | null, input: SpaceInput, userId: number | null): Promise<Result<{ id: number }>> {
  const name = clean(input.name, 60);
  if (!name) return { ok: false, error: "Give the space a name" };
  const checked = checkStatuses(input.statuses ?? DEFAULT_STATUSES);
  if (!checked.ok) return checked;
  const values = {
    name,
    description: clean(input.description, 400),
    color: (COLORS as readonly string[]).includes(input.color ?? "") ? input.color! : "brand",
    icon: (SPACE_ICONS as readonly string[]).includes(input.icon ?? "") ? input.icon! : "layers",
    statuses: checked.statuses,
  };
  if (id) {
    const before = await getSpace(db, id);
    if (!before) return { ok: false, error: "Space not found" };
    // a status that disappears hands its tasks to the first status of the same group (or the first status)
    const gone = before.statuses.filter((s) => !checked.statuses.some((n) => n.key === s.key));
    for (const g of gone) {
      const to = checked.statuses.find((n) => n.group === g.group) ?? checked.statuses[0];
      await db
        .update(tasks)
        .set({ status: to.key, updatedAt: new Date() })
        .where(and(eq(tasks.status, g.key), inArray(tasks.listId, db.select({ id: taskLists.id }).from(taskLists).where(eq(taskLists.spaceId, id)))));
    }
    await db.update(spaces).set(values).where(eq(spaces.id, id));
    await audit(db, { userId, entity: "space", entityId: id, action: "update" });
    return { ok: true, id };
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(spaces);
  const [row] = await db.insert(spaces).values({ ...values, position: Number(n), createdBy: userId }).returning({ id: spaces.id });
  await audit(db, { userId, entity: "space", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

/** Archiving hides the space and its lists; the tasks keep their history and stay on people's own task lists. */
export async function archiveSpace(db: Db, id: number, userId: number | null): Promise<Result> {
  const rows = await db.update(spaces).set({ archivedAt: new Date() }).where(and(eq(spaces.id, id), isNull(spaces.archivedAt))).returning({ id: spaces.id });
  if (!rows.length) return { ok: false, error: "Space not found" };
  await audit(db, { userId, entity: "space", entityId: id, action: "archive" });
  return { ok: true };
}

export async function getList(db: Db, id: number) {
  const [l] = await db.select().from(taskLists).where(and(eq(taskLists.id, id), isNull(taskLists.archivedAt)));
  return l ?? null;
}

export async function saveList(db: Db, id: number | null, input: { spaceId: number; name: string; description?: string | null }, userId: number | null): Promise<Result<{ id: number }>> {
  const name = clean(input.name, 80);
  if (!name) return { ok: false, error: "Give the list a name" };
  if (!(await getSpace(db, input.spaceId))) return { ok: false, error: "Space not found" };
  const values = { spaceId: input.spaceId, name, description: clean(input.description, 400) };
  if (id) {
    const rows = await db.update(taskLists).set(values).where(and(eq(taskLists.id, id), isNull(taskLists.archivedAt))).returning({ id: taskLists.id });
    if (!rows.length) return { ok: false, error: "List not found" };
    await audit(db, { userId, entity: "task_list", entityId: id, action: "update" });
    return { ok: true, id };
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(taskLists).where(eq(taskLists.spaceId, input.spaceId));
  const [row] = await db.insert(taskLists).values({ ...values, position: Number(n) }).returning({ id: taskLists.id });
  await audit(db, { userId, entity: "task_list", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

export async function archiveList(db: Db, id: number, userId: number | null): Promise<Result> {
  const rows = await db.update(taskLists).set({ archivedAt: new Date() }).where(and(eq(taskLists.id, id), isNull(taskLists.archivedAt))).returning({ id: taskLists.id });
  if (!rows.length) return { ok: false, error: "List not found" };
  await audit(db, { userId, entity: "task_list", entityId: id, action: "archive" });
  return { ok: true };
}

/**
 * A starting layout an owner can accept with one click on an empty HQ: one space per area of the company. Every
 * name is editable afterwards; nothing is created until someone asks.
 */
export const STARTER_SPACES: { name: string; description: string; color: Color; icon: string; lists: string[] }[] = [
  { name: "Sales", description: "Sales projects that are bigger than one lead: partnerships, offers, scripts.", color: "brand", icon: "leads", lists: ["Sales projects", "Partnerships"] },
  { name: "Academy", description: "Running the camp: curriculum, batch preparation, instructors.", color: "info", icon: "cohorts", lists: ["Batch preparation", "Curriculum"] },
  { name: "Studio", description: "The production studio's own work beyond the cases.", color: "teal", icon: "layers", lists: ["Studio projects"] },
  { name: "Marketing", description: "Campaigns, content production and the brand.", color: "pink", icon: "sparkle", lists: ["Campaign launches", "Brand"] },
  { name: "Operations", description: "Admin, hiring, tools and finance chores.", color: "warn", icon: "settings", lists: ["Admin", "Hiring"] },
];

export async function createStarterSpaces(db: Db, userId: number | null): Promise<Result<{ created: number }>> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(spaces).where(isNull(spaces.archivedAt));
  if (Number(n) > 0) return { ok: false, error: "HQ already has spaces" };
  for (const s of STARTER_SPACES) {
    const r = await saveSpace(db, null, s, userId);
    if (!r.ok) return r;
    for (const l of s.lists) await saveList(db, null, { spaceId: r.id, name: l }, userId);
  }
  return { ok: true, created: STARTER_SPACES.length };
}

// ---------------- tasks inside a space ----------------

export type HqTask = {
  id: number;
  title: string;
  notes: string | null;
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  listId: number;
  listName: string;
  parentId: number | null;
  assigneeId: number | null;
  assignee: string | null;
  startAt: Date | null;
  dueAt: Date | null;
  doneAt: Date | null;
  tags: string[];
  position: number;
  subtasks: number;
  subtasksDone: number;
  overdue: boolean;
};

export type SpaceTaskFilter = { listId?: number; assigneeId?: number; q?: string; closed?: boolean; subtasks?: boolean };

/** The tasks of a space (or one of its lists), each with a status that is valid for the space. */
export async function spaceTasks(db: Db, space: { id: number; statuses: SpaceStatus[] }, f: SpaceTaskFilter = {}, now = new Date()): Promise<HqTask[]> {
  const where = [eq(taskLists.spaceId, space.id), isNull(taskLists.archivedAt), isNull(tasks.cancelledAt)];
  if (f.listId) where.push(eq(tasks.listId, f.listId));
  if (f.assigneeId) where.push(eq(tasks.assigneeId, f.assigneeId));
  if (!f.closed) where.push(isNull(tasks.doneAt));
  if (!f.subtasks) where.push(isNull(tasks.parentId));
  const q = clean(f.q, 100);
  if (q) where.push(sql`(${tasks.title} ilike ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"} or ${q} = any(${tasks.tags}))`);
  const sub = db
    .select({
      parentId: tasks.parentId,
      n: sql<number>`count(*)::int`.as("n"),
      done: sql<number>`count(*) filter (where ${tasks.doneAt} is not null)::int`.as("done"),
    })
    .from(tasks)
    .where(and(sql`${tasks.parentId} is not null`, isNull(tasks.cancelledAt)))
    .groupBy(tasks.parentId)
    .as("sub");
  const rows = await db
    .select({ t: tasks, listName: taskLists.name, assignee: users.name, n: sub.n, done: sub.done })
    .from(tasks)
    .innerJoin(taskLists, eq(taskLists.id, tasks.listId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(sub, eq(sub.parentId, tasks.id))
    .where(and(...where))
    .orderBy(asc(tasks.position), asc(tasks.id))
    .limit(1000);
  const today = startOfCairoDay(now);
  return rows.map(({ t, listName, assignee, n, done }) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: statusOf(space.statuses, t),
    priority: t.priority,
    listId: t.listId!,
    listName,
    parentId: t.parentId,
    assigneeId: t.assigneeId,
    assignee,
    startAt: t.startAt,
    dueAt: t.dueAt,
    doneAt: t.doneAt,
    tags: t.tags,
    position: t.position,
    subtasks: Number(n ?? 0),
    subtasksDone: Number(done ?? 0),
    overdue: !t.doneAt && !!t.dueAt && t.dueAt < today,
  }));
}

/** A task's status key, falling back sensibly when it has none yet (or one the space no longer has). */
export function statusOf(statuses: SpaceStatus[], t: { status: string | null; doneAt: Date | null }): string {
  const s = statuses.find((x) => x.key === t.status);
  if (s && (s.group === "done") === !!t.doneAt) return s.key;
  return (t.doneAt ? statuses.find((x) => x.group === "done") : statuses.find((x) => x.group !== "done"))?.key ?? statuses[0].key;
}

/** The space a list belongs to, for a task's status checks. */
async function spaceOfList(db: Db, listId: number) {
  const [r] = await db
    .select({ space: spaces })
    .from(taskLists)
    .innerJoin(spaces, eq(spaces.id, taskLists.spaceId))
    .where(and(eq(taskLists.id, listId), isNull(taskLists.archivedAt), isNull(spaces.archivedAt)));
  return r?.space ?? null;
}

/**
 * Moves a task: to another status (Done statuses finish it, others reopen it), another list, or a new place in
 * the order. Used by the board's drag and drop and by every status picker.
 */
export async function moveTask(db: Db, id: number, to: { status?: string; listId?: number; position?: number }, userId: number | null): Promise<Result> {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id), isNull(tasks.cancelledAt)));
  if (!t) return { ok: false, error: "Task not found" };
  const listId = to.listId ?? t.listId;
  if (!listId) return { ok: false, error: "Put the task in a list first" };
  const space = await spaceOfList(db, listId);
  if (!space) return { ok: false, error: "That list no longer exists" };
  const key = to.status ?? statusOf(space.statuses, t);
  const status = space.statuses.find((s) => s.key === key);
  if (!status) return { ok: false, error: "That status is not used in this space" };
  const now = new Date();
  const finishing = status.group === "done";
  await db
    .update(tasks)
    .set({
      listId,
      status: status.key,
      position: to.position ?? t.position,
      doneAt: finishing ? (t.doneAt ?? now) : null,
      doneBy: finishing ? (t.doneAt ? t.doneBy : userId) : null,
      updatedAt: now,
    })
    .where(eq(tasks.id, id));
  await audit(db, { userId, entity: "task", entityId: id, action: "move", diff: { status: status.key, listId } });
  return { ok: true };
}

/** After a task is finished or reopened from outside HQ (the Tasks page, a lead), keep its status in step. */
export async function syncStatus(db: Db, id: number) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!t?.listId) return;
  const space = await spaceOfList(db, t.listId);
  if (!space) return;
  const key = statusOf(space.statuses, t);
  if (key !== t.status) await db.update(tasks).set({ status: key }).where(eq(tasks.id, id));
}

/** Checks a status picked when creating a task in a list; null means "the list's first open status". */
export async function statusForNewTask(db: Db, listId: number, status: string | null | undefined): Promise<Result<{ status: string; done: boolean }>> {
  const space = await spaceOfList(db, listId);
  if (!space) return { ok: false, error: "That list no longer exists" };
  const s = status ? space.statuses.find((x) => x.key === status) : space.statuses.find((x) => x.group !== "done");
  if (!s) return { ok: false, error: "That status is not used in this space" };
  return { ok: true, status: s.key, done: s.group === "done" };
}

/** Everything the task page shows: the task, where it lives, its subtasks and what happened to it. */
export async function taskDetail(db: Db, id: number) {
  const creator = alias(users, "creator");
  const [row] = await db
    .select({ t: tasks, assignee: users.name, creator: creator.name, leadName: leads.fullName, cohortName: cohorts.name, list: taskLists, space: spaces })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .leftJoin(cohorts, eq(cohorts.id, tasks.cohortId))
    .leftJoin(taskLists, eq(taskLists.id, tasks.listId))
    .leftJoin(spaces, eq(spaces.id, taskLists.spaceId))
    .where(eq(tasks.id, id));
  if (!row) return null;
  const [parent, subtasks, history] = await Promise.all([
    row.t.parentId ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, row.t.parentId)).then((r) => r[0] ?? null) : null,
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, doneAt: tasks.doneAt, dueAt: tasks.dueAt, assignee: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.parentId, id), isNull(tasks.cancelledAt)))
      .orderBy(asc(tasks.position), asc(tasks.id)),
    db
      .select({ id: auditLog.id, action: auditLog.action, diff: auditLog.diff, at: auditLog.at, who: users.name })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(and(eq(auditLog.entity, "task"), eq(auditLog.entityId, String(id))))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(30),
  ]);
  const space = row.space && !row.space.archivedAt ? row.space : null;
  return {
    ...row.t,
    status: space ? statusOf(space.statuses, row.t) : null,
    assignee: row.assignee,
    creator: row.creator,
    leadName: row.leadName,
    cohortName: row.cohortName,
    list: row.list && !row.list.archivedAt ? row.list : null,
    space,
    parent,
    subtasks: subtasks.map((x) => ({ ...x, status: space ? statusOf(space.statuses, x) : null })),
    history,
  };
}

// ---------------- my work ----------------

export type WorkBucket = "overdue" | "today" | "next" | "later" | "unscheduled";
export const WORK_BUCKETS: { key: WorkBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "next", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "unscheduled", label: "No date" },
];

export function bucketOf(due: Date | null, now = new Date()): WorkBucket {
  if (!due) return "unscheduled";
  const today = startOfCairoDay(now);
  if (due < today) return "overdue";
  if (due < startOfNextCairoDay(now)) return "today";
  const in7 = startOfCairoDay(new Date(`${addDaysYmd(cairoYmd(now), 8)}T12:00:00Z`));
  return due < in7 ? "next" : "later";
}

// ---------------- docs ----------------

export type DocRow = { id: number; title: string; spaceId: number | null; spaceName: string | null; parentId: number | null; wiki: boolean; updatedAt: Date; updatedBy: string | null };

export async function listDocs(db: Db, f: { spaceId?: number; q?: string; limit?: number } = {}): Promise<DocRow[]> {
  const where = [isNull(docs.archivedAt)];
  if (f.spaceId) where.push(eq(docs.spaceId, f.spaceId));
  const q = clean(f.q, 100);
  if (q) {
    const like = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
    where.push(sql`(${docs.title} ilike ${like} or ${docs.body} ilike ${like})`);
  }
  const rows = await db
    .select({ d: docs, spaceName: spaces.name, updatedBy: users.name })
    .from(docs)
    .leftJoin(spaces, eq(spaces.id, docs.spaceId))
    .leftJoin(users, eq(users.id, docs.updatedBy))
    .where(and(...where))
    .orderBy(desc(docs.wiki), desc(docs.updatedAt))
    .limit(f.limit ?? 300);
  return rows.map(({ d, spaceName, updatedBy }) => ({ id: d.id, title: d.title, spaceId: d.spaceId, spaceName, parentId: d.parentId, wiki: d.wiki, updatedAt: d.updatedAt, updatedBy }));
}

export async function getDoc(db: Db, id: number) {
  const [d] = await db.select().from(docs).where(and(eq(docs.id, id), isNull(docs.archivedAt)));
  if (!d) return null;
  const children = await db.select({ id: docs.id, title: docs.title }).from(docs).where(and(eq(docs.parentId, id), isNull(docs.archivedAt))).orderBy(asc(docs.title));
  return { ...d, children };
}

export type DocInput = { title: string; body?: string; spaceId?: number | null; parentId?: number | null; wiki?: boolean };

export async function saveDoc(db: Db, id: number | null, input: DocInput, userId: number | null): Promise<Result<{ id: number }>> {
  const title = clean(input.title, 140);
  if (!title) return { ok: false, error: "Give the doc a title" };
  const body = (input.body ?? "").slice(0, 100_000);
  if (input.spaceId && !(await getSpace(db, input.spaceId))) return { ok: false, error: "Space not found" };
  let parentId = input.parentId ?? null;
  if (parentId) {
    if (parentId === id) return { ok: false, error: "A doc cannot be its own parent" };
    // walk up from the new parent: it must exist, and must not be this doc's own child
    let cur: number | null = parentId;
    for (let depth = 0; cur; depth++) {
      if (depth > 20) return { ok: false, error: "Pages are nested too deep" };
      const [p]: { parentId: number | null }[] = await db.select({ parentId: docs.parentId }).from(docs).where(and(eq(docs.id, cur), isNull(docs.archivedAt)));
      if (!p) return { ok: false, error: "The parent page no longer exists" };
      if (id && p.parentId === id) return { ok: false, error: "A page cannot sit under one of its own sub-pages" };
      cur = p.parentId;
    }
  } else parentId = null;
  const values = { title, body, spaceId: input.spaceId ?? null, parentId, wiki: !!input.wiki, updatedBy: userId, updatedAt: new Date() };
  if (id) {
    const rows = await db.update(docs).set(values).where(and(eq(docs.id, id), isNull(docs.archivedAt))).returning({ id: docs.id });
    if (!rows.length) return { ok: false, error: "Doc not found" };
    await audit(db, { userId, entity: "doc", entityId: id, action: "update" });
    return { ok: true, id };
  }
  const [row] = await db.insert(docs).values({ ...values, createdBy: userId }).returning({ id: docs.id });
  await audit(db, { userId, entity: "doc", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

/** Archives a doc and its sub-pages together, so no page is left orphaned. */
export async function archiveDoc(db: Db, id: number, userId: number | null): Promise<Result> {
  const rows = await db.execute<{ id: number }>(sql`
    with recursive tree as (select id from docs where id = ${id} and archived_at is null
      union select d.id from docs d join tree t on d.parent_id = t.id where d.archived_at is null)
    update docs set archived_at = now() where id in (select id from tree) returning id`);
  if (!rows.length) return { ok: false, error: "Doc not found" };
  await audit(db, { userId, entity: "doc", entityId: id, action: "archive", diff: { pages: rows.length } });
  return { ok: true };
}
