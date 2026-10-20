import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, decisions, leads, meetings, responsibilities, sopRuns, sops, users, type RunStep } from "@/db/schema";
import { audit } from "./audit";

type Fail = { ok: false; error: string };
type Result<T = object> = ({ ok: true } & T) | Fail;
const clean = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

// ---------------- responsibilities (RACI) ----------------

export const CADENCES = ["daily", "weekly", "monthly", "per batch", "as it happens"] as const;

export type ResponsibilityInput = { area: string; cadence?: string | null; responsibleId?: number | null; accountableId?: number | null; consulted?: string | null; informed?: string | null; notes?: string | null };

export async function saveResponsibility(db: Db, id: number | null, r: ResponsibilityInput, userId: number | null): Promise<Result<{ id: number }>> {
  const area = clean(r.area, 200);
  if (!area) return { ok: false, error: "Say what the job is" };
  const cadence = clean(r.cadence, 40);
  if (cadence && !(CADENCES as readonly string[]).includes(cadence)) return { ok: false, error: "Choose how often" };
  const values = { area, cadence, responsibleId: r.responsibleId ?? null, accountableId: r.accountableId ?? null, consulted: clean(r.consulted, 300), informed: clean(r.informed, 300), notes: clean(r.notes, 2000), updatedBy: userId, updatedAt: new Date() };
  if (id) {
    const u = await db.update(responsibilities).set(values).where(and(eq(responsibilities.id, id), isNull(responsibilities.deletedAt))).returning({ id: responsibilities.id });
    if (!u.length) return { ok: false, error: "Not found" };
  } else {
    const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${responsibilities.position}), 0)::int + 1` }).from(responsibilities);
    [{ id }] = await db.insert(responsibilities).values({ ...values, position: Number(n) }).returning({ id: responsibilities.id });
  }
  await audit(db, { userId, entity: "responsibility", entityId: id, action: "save" });
  return { ok: true, id };
}

export async function deleteResponsibility(db: Db, id: number, userId: number | null) {
  await db.update(responsibilities).set({ deletedAt: new Date() }).where(eq(responsibilities.id, id));
  await audit(db, { userId, entity: "responsibility", entityId: id, action: "delete" });
}

/** Every job with who does it and who answers for it; `gap` when nobody active does it. */
export async function listResponsibilities(db: Db) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select r.*, ru.name as responsible, ru.active as responsible_active, au.name as accountable, au.active as accountable_active
    from responsibilities r left join users ru on ru.id = r.responsible_id left join users au on au.id = r.accountable_id
    where r.deleted_at is null order by r.position, r.id`);
  return [...rows].map((r) => ({
    id: Number(r.id),
    area: String(r.area),
    cadence: (r.cadence as string | null) ?? null,
    responsibleId: (r.responsible_id as number | null) ?? null,
    accountableId: (r.accountable_id as number | null) ?? null,
    responsible: (r.responsible as string | null) ?? null,
    accountable: (r.accountable as string | null) ?? null,
    consulted: (r.consulted as string | null) ?? null,
    informed: (r.informed as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    gap: !r.responsible_id || r.responsible_active === false,
  }));
}

// ---------------- the SOP library ----------------

/** One step per line; 1 to 40 steps of up to 300 characters. Leading "1." or "-" is dropped. */
export function parseSteps(text: string): string[] | string {
  const steps = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);
  if (!steps.length) return "Write the steps, one per line";
  if (steps.length > 40) return "Keep a playbook to 40 steps (split it in two)";
  if (steps.some((s) => s.length > 300)) return "Keep each step under 300 characters";
  return steps;
}

export async function saveSop(db: Db, id: number | null, s: { title: string; area?: string | null; purpose?: string | null; steps: string[] }, userId: number | null): Promise<Result<{ id: number }>> {
  const title = clean(s.title, 200);
  if (!title) return { ok: false, error: "Name the playbook" };
  const values = { title, area: clean(s.area, 60), purpose: clean(s.purpose, 2000), steps: s.steps, updatedBy: userId, updatedAt: new Date() };
  if (id) {
    const u = await db.update(sops).set(values).where(and(eq(sops.id, id), isNull(sops.deletedAt))).returning({ id: sops.id });
    if (!u.length) return { ok: false, error: "Playbook not found" };
  } else {
    [{ id }] = await db.insert(sops).values(values).returning({ id: sops.id });
  }
  await audit(db, { userId, entity: "sop", entityId: id, action: "save", diff: { steps: s.steps.length } });
  return { ok: true, id };
}

export async function deleteSop(db: Db, id: number, userId: number | null) {
  await db.update(sops).set({ deletedAt: new Date() }).where(eq(sops.id, id));
  await audit(db, { userId, entity: "sop", entityId: id, action: "delete" });
}

export async function listSops(db: Db) {
  const rows = await db
    .select({
      s: sops,
      open: sql<number>`(select count(*) from sop_runs r where r.sop_id = sops.id and r.completed_at is null and r.cancelled_at is null)::int`,
      done: sql<number>`(select count(*) from sop_runs r where r.sop_id = sops.id and r.completed_at is not null)::int`,
    })
    .from(sops)
    .where(isNull(sops.deletedAt))
    .orderBy(asc(sops.area), asc(sops.title));
  return rows.map((r) => ({ ...r.s, open: Number(r.open), done: Number(r.done) }));
}

export async function getSop(db: Db, id: number) {
  const [s] = await db.select().from(sops).where(and(eq(sops.id, id), isNull(sops.deletedAt)));
  return s ?? null;
}

/** Start a playbook as a checklist, for a batch or a person if it is about one, with whoever will run it. */
export async function startRun(db: Db, sopId: number, r: { title?: string | null; assigneeId?: number | null; cohortId?: number | null; leadId?: number | null; dueAt?: Date | null }, userId: number | null): Promise<Result<{ id: number }>> {
  const s = await getSop(db, sopId);
  if (!s) return { ok: false, error: "Playbook not found" };
  let suffix = "";
  if (r.cohortId) {
    const [c] = await db.select({ name: cohorts.name }).from(cohorts).where(eq(cohorts.id, r.cohortId));
    if (!c) return { ok: false, error: "Batch not found" };
    suffix = ` — ${c.name}`;
  }
  if (r.leadId) {
    const [l] = await db.select({ name: leads.fullName, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, r.leadId));
    if (!l || l.deletedAt) return { ok: false, error: "Lead not found" };
    suffix = ` — ${l.name}`;
  }
  const title = clean(r.title, 200) ?? `${s.title}${suffix}`.slice(0, 200);
  const [run] = await db
    .insert(sopRuns)
    .values({ sopId, title, steps: s.steps.map((text) => ({ text, doneAt: null, doneBy: null })), assigneeId: r.assigneeId ?? null, cohortId: r.cohortId ?? null, leadId: r.leadId ?? null, dueAt: r.dueAt ?? null, startedBy: userId })
    .returning({ id: sopRuns.id });
  await audit(db, { userId, entity: "sop_run", entityId: run.id, action: "start" });
  return { ok: true, id: run.id };
}

/** Tick or untick one step. The checklist completes itself when every step is ticked (and reopens if one is unticked). */
export async function tickStep(db: Db, runId: number, index: number, done: boolean, userId: number | null): Promise<Result<{ complete: boolean }>> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(sopRuns).where(eq(sopRuns.id, runId)).for("update");
    if (!r || r.cancelledAt) return { ok: false as const, error: "Checklist not found" };
    if (!Number.isInteger(index) || index < 0 || index >= r.steps.length) return { ok: false as const, error: "No such step" };
    const steps: RunStep[] = r.steps.map((s, i) => (i === index ? { ...s, doneAt: done ? new Date().toISOString() : null, doneBy: done ? userId : null } : s));
    const complete = steps.every((s) => s.doneAt);
    await tx.update(sopRuns).set({ steps, completedAt: complete ? (r.completedAt ?? new Date()) : null }).where(eq(sopRuns.id, runId));
    if (complete && !r.completedAt) await audit(tx, { userId, entity: "sop_run", entityId: runId, action: "complete" });
    return { ok: true as const, complete };
  });
}

export async function cancelRun(db: Db, runId: number, userId: number | null) {
  await db.update(sopRuns).set({ cancelledAt: new Date() }).where(and(eq(sopRuns.id, runId), isNull(sopRuns.completedAt)));
  await audit(db, { userId, entity: "sop_run", entityId: runId, action: "cancel" });
}

export type RunRow = Awaited<ReturnType<typeof listRuns>>[number];

export async function listRuns(db: Db, f: { sopId?: number; open?: boolean; assigneeId?: number; leadId?: number } = {}) {
  const where: (SQL | undefined)[] = [isNull(sopRuns.cancelledAt)];
  if (f.sopId) where.push(eq(sopRuns.sopId, f.sopId));
  if (f.open) where.push(isNull(sopRuns.completedAt));
  if (f.assigneeId) where.push(eq(sopRuns.assigneeId, f.assigneeId));
  if (f.leadId) where.push(eq(sopRuns.leadId, f.leadId));
  const rows = await db
    .select({ r: sopRuns, assignee: users.name })
    .from(sopRuns)
    .leftJoin(users, eq(users.id, sopRuns.assigneeId))
    .where(and(...where))
    .orderBy(sql`${sopRuns.completedAt} is not null`, sql`${sopRuns.dueAt} asc nulls last`, desc(sopRuns.startedAt))
    .limit(200);
  return rows.map((x) => ({ ...x.r, assignee: x.assignee, doneSteps: x.r.steps.filter((s) => s.doneAt).length }));
}

export async function getRun(db: Db, id: number) {
  const [x] = await db
    .select({ r: sopRuns, assignee: users.name, sopTitle: sops.title, cohort: cohorts.name, lead: leads.fullName })
    .from(sopRuns)
    .innerJoin(sops, eq(sops.id, sopRuns.sopId))
    .leftJoin(users, eq(users.id, sopRuns.assigneeId))
    .leftJoin(cohorts, eq(cohorts.id, sopRuns.cohortId))
    .leftJoin(leads, eq(leads.id, sopRuns.leadId))
    .where(eq(sopRuns.id, id));
  return x ? { ...x.r, assignee: x.assignee, sopTitle: x.sopTitle, cohort: x.cohort, lead: x.lead } : null;
}

// ---------------- meetings and decisions ----------------

export async function saveMeeting(db: Db, id: number | null, m: { title: string; heldAt: Date; attendees?: string | null; agenda?: string | null; notes?: string | null }, userId: number | null): Promise<Result<{ id: number }>> {
  const title = clean(m.title, 200);
  if (!title) return { ok: false, error: "Name the meeting" };
  if (!(m.heldAt instanceof Date) || Number.isNaN(m.heldAt.getTime())) return { ok: false, error: "Pick the date" };
  const values = { title, heldAt: m.heldAt, attendees: clean(m.attendees, 500), agenda: clean(m.agenda, 8000), notes: clean(m.notes, 20000), updatedAt: new Date() };
  if (id) {
    const u = await db.update(meetings).set(values).where(eq(meetings.id, id)).returning({ id: meetings.id });
    if (!u.length) return { ok: false, error: "Meeting not found" };
  } else {
    [{ id }] = await db.insert(meetings).values({ ...values, createdBy: userId }).returning({ id: meetings.id });
  }
  await audit(db, { userId, entity: "meeting", entityId: id, action: "save" });
  return { ok: true, id };
}

export async function listMeetings(db: Db) {
  const rows = await db
    .select({ m: meetings, open: sql<number>`(select count(*) from decisions d where d.meeting_id = meetings.id and d.status = 'open')::int`, total: sql<number>`(select count(*) from decisions d where d.meeting_id = meetings.id)::int` })
    .from(meetings)
    .orderBy(desc(meetings.heldAt))
    .limit(200);
  return rows.map((r) => ({ ...r.m, open: Number(r.open), total: Number(r.total) }));
}

export async function getMeeting(db: Db, id: number) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  return m ?? null;
}

export const DECISION_STATUS = { open: "Open", done: "Done", dropped: "Dropped" } as const;

export async function addDecision(db: Db, d: { meetingId?: number | null; title: string; detail?: string | null; ownerId?: number | null; dueAt?: Date | null }, userId: number | null): Promise<Result<{ id: number }>> {
  const title = clean(d.title, 300);
  if (!title) return { ok: false, error: "Write the decision" };
  if (d.meetingId && !(await getMeeting(db, d.meetingId))) return { ok: false, error: "Meeting not found" };
  const [row] = await db.insert(decisions).values({ meetingId: d.meetingId ?? null, title, detail: clean(d.detail, 4000), ownerId: d.ownerId ?? null, dueAt: d.dueAt ?? null, createdBy: userId }).returning({ id: decisions.id });
  await audit(db, { userId, entity: "decision", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

/** Close a decision: done (with what happened) or dropped. Its owner or an owner of the business. */
export async function closeDecision(db: Db, id: number, status: "done" | "dropped" | "open", outcome: string | null, user: { id: number; canManage: boolean }): Promise<Result> {
  const [d] = await db.select().from(decisions).where(eq(decisions.id, id));
  if (!d) return { ok: false, error: "Decision not found" };
  if (!user.canManage && d.ownerId !== user.id) return { ok: false, error: "Only its owner, or an owner of the business, can close a decision" };
  await db
    .update(decisions)
    .set(status === "open" ? { status, closedAt: null, closedBy: null } : { status, outcome: clean(outcome, 2000), closedAt: new Date(), closedBy: user.id })
    .where(eq(decisions.id, id));
  await audit(db, { userId: user.id, entity: "decision", entityId: id, action: status });
  return { ok: true };
}

export type DecisionRow = Awaited<ReturnType<typeof listDecisions>>[number];

export async function listDecisions(db: Db, f: { meetingId?: number; status?: "open" | "closed"; ownerId?: number } = {}, now = new Date()) {
  const where: (SQL | undefined)[] = [];
  if (f.meetingId) where.push(eq(decisions.meetingId, f.meetingId));
  if (f.status === "open") where.push(eq(decisions.status, "open"));
  if (f.status === "closed") where.push(sql`${decisions.status} <> 'open'`);
  if (f.ownerId) where.push(eq(decisions.ownerId, f.ownerId));
  const rows = await db
    .select({ d: decisions, owner: users.name, meeting: meetings.title })
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.ownerId))
    .leftJoin(meetings, eq(meetings.id, decisions.meetingId))
    .where(and(...where))
    .orderBy(sql`${decisions.status} <> 'open'`, sql`${decisions.dueAt} asc nulls last`, desc(decisions.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.d, owner: r.owner, meeting: r.meeting, overdue: r.d.status === "open" && !!r.d.dueAt && r.d.dueAt < now }));
}
