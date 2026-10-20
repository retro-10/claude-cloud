import { sql } from "drizzle-orm";
import type { Db } from "@/db";

/**
 * Early warning on students likely to drop. A plain, explainable score from what the app already records: no
 * AI, so it works with the assistant off, and every point comes with a reason a person can act on.
 *
 *   attendance under the batch's graduation minimum  +30 (+40 if 15 points or more under)
 *   missed the last two classes (not excused)         +25 (the last one only: +10)
 *   each assignment past its due date, not handed in  +15, at most +30
 *   sent back for rework over a week ago, not redone  +10
 *   an instalment overdue (only for people who see money) +25
 *
 * 50 or more is "at risk", 25 to 49 "watch".
 */
export type RiskFacts = {
  attendanceRate: number | null; // 0..1 over classes marked (excused not counted)
  minAttendancePct: number;
  lastTwo: ("present" | "late" | "absent")[]; // newest first
  overdueWork: number;
  staleRework: number;
  paymentOverdue: boolean;
};

export type RiskLevel = "risk" | "watch" | "ok";

export function scoreRisk(f: RiskFacts, money: boolean): { score: number; level: RiskLevel; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (f.attendanceRate !== null) {
    const pct = Math.round(f.attendanceRate * 100);
    if (pct < f.minAttendancePct) {
      score += pct <= f.minAttendancePct - 15 ? 40 : 30;
      reasons.push(`Attendance ${pct}% (the batch needs ${f.minAttendancePct}%)`);
    }
  }
  if (f.lastTwo[0] === "absent" && f.lastTwo[1] === "absent") {
    score += 25;
    reasons.push("Missed the last two classes");
  } else if (f.lastTwo[0] === "absent") {
    score += 10;
    reasons.push("Missed the last class");
  }
  if (f.overdueWork > 0) {
    score += Math.min(30, 15 * f.overdueWork);
    reasons.push(`${f.overdueWork} assignment${f.overdueWork === 1 ? "" : "s"} past due, not handed in`);
  }
  if (f.staleRework > 0) {
    score += 10;
    reasons.push(`Rework not redone after a week (${f.staleRework})`);
  }
  if (money && f.paymentOverdue) {
    score += 25;
    reasons.push("An instalment is overdue");
  }
  return { score, level: score >= 50 ? "risk" : score >= 25 ? "watch" : "ok", reasons };
}

export type StudentRisk = { enrolmentId: number; leadId: number; fullName: string; cohortId: number; cohort: string; score: number; level: RiskLevel; reasons: string[] };

/** Active students (optionally of one batch) scored, highest first. Students with nothing against them are left out. */
export async function studentRisks(db: Db, opts: { cohortId?: number; money: boolean; now?: Date }): Promise<StudentRisk[]> {
  const now = (opts.now ?? new Date()).toISOString();
  const rows = await db.execute<Record<string, unknown>>(sql`
    select e.id as enrolment_id, e.lead_id, l.full_name, c.id as cohort_id, c.name as cohort, c.grad_min_attendance_pct as min_pct,
      (select count(*) filter (where a.status in ('present','late')) from class_attendance a join batch_classes b on b.id = a.class_id and b.deleted_at is null
        where a.enrolment_id = e.id and a.status <> 'excused')::int as came,
      (select count(*) from class_attendance a join batch_classes b on b.id = a.class_id and b.deleted_at is null
        where a.enrolment_id = e.id and a.status <> 'excused')::int as counted,
      (select coalesce(array_agg(s.status order by s.starts_at desc), '{}') from (
        select a.status::text as status, b.starts_at from class_attendance a join batch_classes b on b.id = a.class_id and b.deleted_at is null
        where a.enrolment_id = e.id and a.status <> 'excused' order by b.starts_at desc limit 2) s) as last_two,
      (select count(*) from assignments x where x.cohort_id = e.cohort_id and x.deleted_at is null and x.due_at < ${now}::timestamptz
        and not exists (select 1 from submissions s where s.assignment_id = x.id and s.enrolment_id = e.id))::int as overdue_work,
      (select count(*) from assignments x where x.cohort_id = e.cohort_id and x.deleted_at is null
        and (select s.status from submissions s where s.assignment_id = x.id and s.enrolment_id = e.id order by s.attempt desc, s.id desc limit 1) = 'rework'
        and (select max(s.submitted_at) from submissions s where s.assignment_id = x.id and s.enrolment_id = e.id) < ${now}::timestamptz - interval '7 days')::int as stale_rework,
      exists (select 1 from ledger_entries x where x.enrolment_id = e.id and x.deleted_at is null and x.section = 'income' and x.status = 'expected' and x.date < ${now}::timestamptz) as payment_overdue
    from enrolments e join leads l on l.id = e.lead_id and l.deleted_at is null join cohorts c on c.id = e.cohort_id
    where e.status = 'active' and c.status <> 'closed' ${opts.cohortId ? sql`and e.cohort_id = ${opts.cohortId}` : sql``}`);
  return [...rows]
    .map((r) => {
      const counted = Number(r.counted);
      const s = scoreRisk(
        {
          attendanceRate: counted ? Number(r.came) / counted : null,
          minAttendancePct: Number(r.min_pct),
          lastTwo: (r.last_two as RiskFacts["lastTwo"]) ?? [],
          overdueWork: Number(r.overdue_work),
          staleRework: Number(r.stale_rework),
          paymentOverdue: Boolean(r.payment_overdue),
        },
        opts.money,
      );
      return { enrolmentId: Number(r.enrolment_id), leadId: Number(r.lead_id), fullName: String(r.full_name), cohortId: Number(r.cohort_id), cohort: String(r.cohort), ...s };
    })
    .filter((r) => r.level !== "ok")
    .sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName));
}
