import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { assignments, cohorts, enrolments, leads, submissions, users, type RubricCriterion, type RubricScore } from "@/db/schema";
import { audit } from "./audit";

export const SUBMISSION_STATUS = { submitted: "Waiting for review", rework: "Needs rework", passed: "Passed" } as const;

/** "Margins and fit | 40" per line → criteria. 1 to 10 criteria, names up to 60 characters, 1 to 100 points each. */
export function parseRubric(text: string): RubricCriterion[] | string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "Add at least one criterion, one per line: name | points";
  if (lines.length > 10) return "Keep the rubric to 10 criteria";
  const out: RubricCriterion[] = [];
  for (const l of lines) {
    const m = l.match(/^(.{1,60}?)\s*\|\s*(\d{1,3})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 100) return `Write each criterion as "name | points" (1 to 100): "${l.slice(0, 40)}"`;
    out.push({ name: m[1].trim(), max: Number(m[2]) });
  }
  if (new Set(out.map((c) => c.name.toLowerCase())).size !== out.length) return "Each criterion needs its own name";
  return out;
}
export const rubricText = (r: RubricCriterion[]) => r.map((c) => `${c.name} | ${c.max}`).join("\n");

export type AssignmentInput = { cohortId: number; title: string; brief?: string | null; dueAt?: Date | null; rubric: RubricCriterion[]; passPct: number };
type Fail = { ok: false; error: string };

export async function saveAssignment(db: Db, id: number | null, a: AssignmentInput, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  const title = a.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Name the assignment" };
  if (!Number.isInteger(a.passPct) || a.passPct < 1 || a.passPct > 100) return { ok: false, error: "The pass mark is 1 to 100%" };
  const [c] = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, a.cohortId));
  if (!c) return { ok: false, error: "Batch not found" };
  const values = { cohortId: a.cohortId, title, brief: a.brief?.trim().slice(0, 8000) || null, dueAt: a.dueAt ?? null, rubric: a.rubric, passPct: a.passPct, updatedAt: new Date() };
  if (id) {
    const r = await db.update(assignments).set(values).where(and(eq(assignments.id, id), isNull(assignments.deletedAt))).returning({ id: assignments.id });
    if (!r.length) return { ok: false, error: "Assignment not found" };
  } else {
    const [r] = await db.insert(assignments).values({ ...values, createdBy: userId }).returning({ id: assignments.id });
    id = r.id;
  }
  await audit(db, { userId, entity: "assignment", entityId: id, action: "save" });
  return { ok: true, id };
}

export async function deleteAssignment(db: Db, id: number, userId: number | null) {
  await db.update(assignments).set({ deletedAt: new Date() }).where(eq(assignments.id, id));
  await audit(db, { userId, entity: "assignment", entityId: id, action: "delete" });
}

export async function getAssignment(db: Db, id: number) {
  const [a] = await db.select({ a: assignments, cohort: cohorts.name }).from(assignments).innerJoin(cohorts, eq(cohorts.id, assignments.cohortId)).where(and(eq(assignments.id, id), isNull(assignments.deletedAt)));
  return a ? { ...a.a, cohort: a.cohort } : null;
}

export async function listAssignments(db: Db, f: { cohortId?: number } = {}) {
  const where: (SQL | undefined)[] = [isNull(assignments.deletedAt)];
  if (f.cohortId) where.push(eq(assignments.cohortId, f.cohortId));
  const rows = await db
    .select({
      a: assignments,
      cohort: cohorts.name,
      students: sql<number>`(select count(*) from enrolments e where e.cohort_id = ${assignments.cohortId} and e.status <> 'dropped')::int`,
      waiting: sql<number>`(select count(*) from submissions x where x.assignment_id = ${assignments.id} and x.status = 'submitted')::int`,
      passed: sql<number>`(select count(*) from submissions x where x.assignment_id = ${assignments.id} and x.status = 'passed')::int`,
      rework: sql<number>`(select count(*) from submissions x where x.assignment_id = ${assignments.id} and x.status = 'rework')::int`,
    })
    .from(assignments)
    .innerJoin(cohorts, eq(cohorts.id, assignments.cohortId))
    .where(and(...where))
    .orderBy(sql`${assignments.dueAt} asc nulls last`, asc(assignments.id));
  return rows.map((r) => ({ ...r.a, cohort: r.cohort, students: Number(r.students), waiting: Number(r.waiting), passed: Number(r.passed), rework: Number(r.rework) }));
}

/** The batch's students (not dropped) with their submission for this assignment, if any. */
export async function submissionsFor(db: Db, assignmentId: number) {
  const a = await getAssignment(db, assignmentId);
  if (!a) return [];
  const rows = await db
    .select({ enrolmentId: enrolments.id, leadId: leads.id, fullName: leads.fullName, sub: submissions, reviewer: users.name })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .leftJoin(submissions, and(eq(submissions.enrolmentId, enrolments.id), eq(submissions.assignmentId, assignmentId)))
    .leftJoin(users, eq(users.id, submissions.reviewerId))
    .where(and(eq(enrolments.cohortId, a.cohortId), sql`${enrolments.status} <> 'dropped'`))
    .orderBy(sql`case ${submissions.status} when 'submitted' then 0 when 'rework' then 1 when 'passed' then 2 else 3 end`, asc(leads.fullName));
  return rows;
}

/**
 * A submission (from the student in the portal, or recorded by staff). Sending again after a review is a new
 * attempt: the old scores are cleared and it waits for review again.
 */
export async function recordSubmission(
  db: Db,
  assignmentId: number,
  enrolmentId: number,
  s: { attachmentId?: number | null; link?: string | null; note?: string | null },
  by: { userId: number | null; student?: boolean },
): Promise<{ ok: true; id: number; attempt: number } | Fail> {
  const a = await getAssignment(db, assignmentId);
  if (!a) return { ok: false, error: "Assignment not found" };
  const [e] = await db.select({ cohortId: enrolments.cohortId, status: enrolments.status }).from(enrolments).where(eq(enrolments.id, enrolmentId));
  if (!e || e.cohortId !== a.cohortId || e.status === "dropped") return { ok: false, error: "That student is not in this assignment's batch" };
  const link = s.link?.trim() || null;
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { ok: false, error: "The link must start with https://" };
  if (!s.attachmentId && !link) return { ok: false, error: "Attach the file or paste a link to it" };
  const [cur] = await db.select().from(submissions).where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.enrolmentId, enrolmentId)));
  if (cur?.status === "passed") return { ok: false, error: "This assignment is already passed" };
  const values = { attachmentId: s.attachmentId ?? null, link, note: s.note?.trim().slice(0, 2000) || null, submittedAt: new Date(), status: "submitted" as const, scores: null, totalPct: null, reviewerId: null, reviewedAt: null };
  let id: number, attempt: number;
  if (cur) {
    attempt = cur.attempt + 1;
    await db.update(submissions).set({ ...values, attempt, feedback: cur.feedback }).where(eq(submissions.id, cur.id));
    id = cur.id;
  } else {
    attempt = 1;
    [{ id }] = await db.insert(submissions).values({ assignmentId, enrolmentId, ...values }).returning({ id: submissions.id });
  }
  await audit(db, { userId: by.userId, entity: "submission", entityId: id, action: by.student ? "submit_portal" : "submit", diff: { attempt } });
  return { ok: true, id, attempt };
}

/** Score each criterion; the total decides passed or rework against the assignment's pass mark. */
export async function reviewSubmission(db: Db, submissionId: number, scores: number[], feedback: string | null, userId: number | null): Promise<{ ok: true; totalPct: number; passed: boolean } | Fail> {
  const [row] = await db.select({ s: submissions, a: assignments }).from(submissions).innerJoin(assignments, eq(assignments.id, submissions.assignmentId)).where(eq(submissions.id, submissionId));
  if (!row) return { ok: false, error: "Submission not found" };
  const rubric = row.a.rubric;
  if (scores.length !== rubric.length) return { ok: false, error: "Score every criterion" };
  const scored: RubricScore[] = [];
  for (let i = 0; i < rubric.length; i++) {
    const v = scores[i];
    if (!Number.isFinite(v) || v < 0 || v > rubric[i].max || Math.round(v * 2) !== v * 2) return { ok: false, error: `${rubric[i].name}: 0 to ${rubric[i].max} points` };
    scored.push({ ...rubric[i], score: v });
  }
  const max = rubric.reduce((a, c) => a + c.max, 0);
  const totalPct = Math.round((scored.reduce((a, c) => a + c.score, 0) / max) * 100);
  const passed = totalPct >= row.a.passPct;
  await db
    .update(submissions)
    .set({ scores: scored, totalPct, status: passed ? "passed" : "rework", feedback: feedback?.trim().slice(0, 4000) || null, reviewerId: userId, reviewedAt: new Date() })
    .where(eq(submissions.id, submissionId));
  await audit(db, { userId, entity: "submission", entityId: submissionId, action: "review", diff: { totalPct, passed } });
  await refreshQcAndRanks(db, row.s.enrolmentId, row.a.cohortId);
  return { ok: true, totalPct, passed };
}

/**
 * QC score = the average result of the student's reviewed submissions (the latest attempt of each). Then the
 * batch's leaderboard: rank by QC score, ties share a rank (1, 1, 3). Only batches that use reviews are ranked
 * here; a rank typed by hand (or in Notion) elsewhere is left alone.
 */
export async function refreshQcAndRanks(db: Db, enrolmentId: number, cohortId: number) {
  await db.execute(sql`
    update enrolments e set qc_score = q.avg, updated_at = now()
    from (select round(avg(total_pct))::int as avg from submissions where enrolment_id = ${enrolmentId} and total_pct is not null) q
    where e.id = ${enrolmentId} and q.avg is not null and e.qc_score is distinct from q.avg`);
  await db.execute(sql`
    update enrolments e set leaderboard_rank = r.rank, updated_at = now()
    from (select id, rank() over (order by qc_score desc)::int as rank from enrolments
          where cohort_id = ${cohortId} and status <> 'dropped' and qc_score is not null) r
    where e.id = r.id and e.leaderboard_rank is distinct from r.rank`);
}

/** Every assignment of the student's batch with their submission (the portal, and the lead page). */
export async function studentAssignments(db: Db, enrolmentId: number) {
  const [e] = await db.select({ cohortId: enrolments.cohortId }).from(enrolments).where(eq(enrolments.id, enrolmentId));
  if (!e) return [];
  return db
    .select({ a: assignments, sub: submissions })
    .from(assignments)
    .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.enrolmentId, enrolmentId)))
    .where(and(eq(assignments.cohortId, e.cohortId), isNull(assignments.deletedAt)))
    .orderBy(sql`${assignments.dueAt} asc nulls last`, asc(assignments.id));
}
