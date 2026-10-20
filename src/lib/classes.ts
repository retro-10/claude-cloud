import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { batchClasses, classAttendance, cohorts, enrolments, leads, tasks, users } from "@/db/schema";
import { audit } from "./audit";
import { createTask } from "./tasks";
import { addDaysYmd, cairoLocalToDate, cairoYmd, toCairoLocalInput } from "./time";

export const ATTENDANCE = { present: "Present", late: "Late", absent: "Absent", excused: "Excused" } as const;
export type AttendanceStatus = keyof typeof ATTENDANCE;
/** After this many unexcused absences in a batch, a check-in task is made (once). */
export const MISSED_FOR_CHECK_IN = 2;

export type ClassInput = {
  cohortId: number;
  title: string;
  module?: string | null;
  startsAt: Date;
  durationMin?: number;
  instructorId?: number | null;
  location?: string | null;
  recordingUrl?: string | null;
  materialsUrl?: string | null;
  notes?: string | null;
};
type Fail = { ok: false; error: string };
const clean = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);
const url = (s: string | null | undefined) => {
  const v = clean(s, 500);
  return v && !/^https?:\/\/\S+$/i.test(v) ? "bad" : v;
};

export async function saveClass(db: Db, id: number | null, c: ClassInput, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  const title = clean(c.title, 200);
  if (!title) return { ok: false, error: "Name the class" };
  if (!(c.startsAt instanceof Date) || Number.isNaN(c.startsAt.getTime())) return { ok: false, error: "Pick the date and time" };
  const duration = c.durationMin ?? 120;
  if (!Number.isInteger(duration) || duration < 15 || duration > 600) return { ok: false, error: "Length is 15 to 600 minutes" };
  const recordingUrl = url(c.recordingUrl), materialsUrl = url(c.materialsUrl);
  if (recordingUrl === "bad" || materialsUrl === "bad") return { ok: false, error: "Links must start with https://" };
  const [cohort] = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, c.cohortId));
  if (!cohort) return { ok: false, error: "Batch not found" };
  const values = { cohortId: c.cohortId, title, module: clean(c.module, 120), startsAt: c.startsAt, durationMin: duration, instructorId: c.instructorId ?? null, location: clean(c.location, 300), recordingUrl, materialsUrl, notes: clean(c.notes, 4000), updatedAt: new Date() };
  if (id) {
    const r = await db.update(batchClasses).set(values).where(and(eq(batchClasses.id, id), isNull(batchClasses.deletedAt))).returning({ id: batchClasses.id });
    if (!r.length) return { ok: false, error: "Class not found" };
  } else {
    const [r] = await db.insert(batchClasses).values(values).returning({ id: batchClasses.id });
    id = r.id;
  }
  await audit(db, { userId, entity: "class", entityId: id, action: "save" });
  return { ok: true, id };
}

export async function deleteClass(db: Db, id: number, userId: number | null) {
  await db.update(batchClasses).set({ deletedAt: new Date() }).where(eq(batchClasses.id, id));
  await audit(db, { userId, entity: "class", entityId: id, action: "delete" });
}

export type ClassRow = Awaited<ReturnType<typeof listClasses>>[number];

export async function listClasses(db: Db, f: { cohortId?: number; from?: Date; to?: Date; instructorId?: number } = {}) {
  const where: (SQL | undefined)[] = [isNull(batchClasses.deletedAt)];
  if (f.cohortId) where.push(eq(batchClasses.cohortId, f.cohortId));
  if (f.instructorId) where.push(eq(batchClasses.instructorId, f.instructorId));
  if (f.from) where.push(sql`${batchClasses.startsAt} >= ${f.from.toISOString()}::timestamptz`);
  if (f.to) where.push(sql`${batchClasses.startsAt} < ${f.to.toISOString()}::timestamptz`);
  const rows = await db
    .select({
      c: batchClasses,
      cohort: cohorts.name,
      instructor: users.name,
      marked: sql<number>`(select count(*) from class_attendance a where a.class_id = ${batchClasses.id})::int`,
      came: sql<number>`(select count(*) from class_attendance a where a.class_id = ${batchClasses.id} and a.status in ('present', 'late'))::int`,
    })
    .from(batchClasses)
    .innerJoin(cohorts, eq(cohorts.id, batchClasses.cohortId))
    .leftJoin(users, eq(users.id, batchClasses.instructorId))
    .where(and(...where))
    .orderBy(asc(batchClasses.startsAt));
  return rows.map((r) => ({ ...r.c, cohort: r.cohort, instructor: r.instructor, marked: Number(r.marked), came: Number(r.came) }));
}

export async function getClass(db: Db, id: number) {
  const [r] = await db.select().from(batchClasses).where(and(eq(batchClasses.id, id), isNull(batchClasses.deletedAt)));
  return r ?? null;
}

/**
 * Copy another batch's schedule: the same classes in the same order and gaps, starting on `firstDay` (Cairo date),
 * each at its original time of day. Recordings are not copied; materials and notes are.
 */
export async function copySchedule(db: Db, fromCohortId: number, toCohortId: number, firstDay: string, userId: number | null): Promise<{ ok: true; copied: number } | Fail> {
  if (fromCohortId === toCohortId) return { ok: false, error: "Pick another batch to copy from" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) return { ok: false, error: "Pick the first class date" };
  const source = await listClasses(db, { cohortId: fromCohortId });
  if (!source.length) return { ok: false, error: "That batch has no classes to copy" };
  const startDay = cairoYmd(source[0].startsAt);
  const shift = Math.round((Date.parse(`${firstDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000);
  for (const s of source) {
    const time = toCairoLocalInput(s.startsAt).slice(11);
    const day = addDaysYmd(cairoYmd(s.startsAt), shift);
    const r = await saveClass(
      db,
      null,
      { cohortId: toCohortId, title: s.title, module: s.module, startsAt: cairoLocalToDate(`${day}T${time}`)!, durationMin: s.durationMin, instructorId: s.instructorId, location: s.location, materialsUrl: s.materialsUrl, notes: s.notes },
      userId,
    );
    if (!r.ok) return r;
  }
  return { ok: true, copied: source.length };
}

/** The class's students (not dropped) and how each was marked. */
export async function roster(db: Db, classId: number) {
  const c = await getClass(db, classId);
  if (!c) return [];
  const rows = await db
    .select({ enrolmentId: enrolments.id, leadId: leads.id, fullName: leads.fullName, status: classAttendance.status })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .leftJoin(classAttendance, and(eq(classAttendance.enrolmentId, enrolments.id), eq(classAttendance.classId, classId)))
    .where(and(eq(enrolments.cohortId, c.cohortId), sql`${enrolments.status} <> 'dropped'`))
    .orderBy(asc(leads.fullName));
  return rows.map((r) => ({ ...r, status: (r.status ?? null) as AttendanceStatus | null }));
}

/**
 * Record who came. Then, for anyone who has now missed MISSED_FOR_CHECK_IN classes in this batch without an
 * excuse, a check-in task is made (once per student and batch) for the person marking.
 */
export async function markAttendance(db: Db, classId: number, marks: { enrolmentId: number; status: AttendanceStatus | null }[], userId: number | null) {
  const c = await getClass(db, classId);
  if (!c) return { ok: false as const, error: "Class not found" };
  const inBatch = new Set(
    (await db.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.cohortId, c.cohortId), inArray(enrolments.id, marks.length ? marks.map((m) => m.enrolmentId) : [0])))).map((r) => r.id),
  );
  const valid = marks.filter((m) => inBatch.has(m.enrolmentId));
  for (const m of valid) {
    if (m.status === null) {
      await db.delete(classAttendance).where(and(eq(classAttendance.classId, classId), eq(classAttendance.enrolmentId, m.enrolmentId)));
      continue;
    }
    await db
      .insert(classAttendance)
      .values({ classId, enrolmentId: m.enrolmentId, status: m.status, markedBy: userId })
      .onConflictDoUpdate({ target: [classAttendance.classId, classAttendance.enrolmentId], set: { status: m.status, markedBy: userId, markedAt: new Date() } });
  }
  await audit(db, { userId, entity: "class", entityId: classId, action: "attendance", diff: { marked: valid.length } });

  const checkIns: number[] = [];
  const absent = valid.filter((m) => m.status === "absent").map((m) => m.enrolmentId);
  if (absent.length) {
    const misses = await db.execute<{ enrolment_id: number; lead_id: number; full_name: string; n: number }>(sql`
      select e.id as enrolment_id, l.id as lead_id, l.full_name, count(*)::int as n
      from class_attendance a join batch_classes b on b.id = a.class_id and b.deleted_at is null
        join enrolments e on e.id = a.enrolment_id join leads l on l.id = e.lead_id
      where a.status = 'absent' and b.cohort_id = ${c.cohortId} and e.id in (${sql.join(absent.map((x) => sql`${x}`), sql`, `)})
      group by e.id, l.id, l.full_name having count(*) >= ${MISSED_FOR_CHECK_IN}`);
    for (const m of misses) {
      const [already] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.leadId, Number(m.lead_id)), eq(tasks.cohortId, c.cohortId), sql`${tasks.title} like 'Check in with % (missed classes)'`));
      if (already) continue;
      const t = await createTask(
        db,
        { title: `Check in with ${m.full_name} (missed classes)`.slice(0, 200), notes: `Missed ${m.n} classes in this batch without an excuse. Ask how they are and what would help.`, priority: "high", leadId: Number(m.lead_id), cohortId: c.cohortId, dueAt: new Date(Date.now() + 86_400_000) },
        userId,
      );
      if (t.ok) checkIns.push(t.id);
    }
  }
  return { ok: true as const, marked: valid.length, checkIns: checkIns.length };
}

/** Per student in a batch: how they attended the classes that were marked. Rate = (present + late) ÷ marked. */
export async function attendanceSummary(db: Db, cohortId: number) {
  const rows = await db.execute<{ enrolment_id: number; present: number; late: number; absent: number; excused: number }>(sql`
    select a.enrolment_id,
      count(*) filter (where a.status = 'present')::int as present, count(*) filter (where a.status = 'late')::int as late,
      count(*) filter (where a.status = 'absent')::int as absent, count(*) filter (where a.status = 'excused')::int as excused
    from class_attendance a join batch_classes b on b.id = a.class_id and b.deleted_at is null
    where b.cohort_id = ${cohortId} group by a.enrolment_id`);
  return new Map(
    [...rows].map((r) => {
      const came = Number(r.present) + Number(r.late);
      const counted = came + Number(r.absent); // excused classes do not count against anyone
      return [Number(r.enrolment_id), { present: Number(r.present), late: Number(r.late), absent: Number(r.absent), excused: Number(r.excused), rate: counted ? came / counted : null }];
    }),
  );
}
