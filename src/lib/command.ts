import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { notionSyncRuns, weeklyReviews } from "@/db/schema";
import { getSettings } from "./app-settings";
import { audit } from "./audit";
import { navCounts } from "./nav-counts";
import { can, type Role } from "./rbac";
import { actuals, progressFor, quarterOf } from "./targets";
import { addDaysYmd, cairoLocalToDate, cairoYmd, startOfCairoDay } from "./time";

// ---------------- pulse: the last 7 days against the 7 before ----------------

export const PULSE = [
  { key: "leads", label: "New leads", money: false },
  { key: "consults_held", label: "Consults held", money: false },
  { key: "enrolments", label: "Enrolments", money: false },
  { key: "cash_egp", label: "Cash collected", money: true },
  { key: "tasks_done", label: "Tasks done", money: false },
] as const;
export type PulseKey = (typeof PULSE)[number]["key"];
export type Pulse = Record<PulseKey, { now: number; before: number }>;

async function window(db: Db, start: Date, end: Date): Promise<Record<PulseKey, number>> {
  const [a, [t]] = await Promise.all([
    actuals(db, start, end),
    db.execute<{ n: number }>(sql`select count(*)::int as n from tasks where done_at >= ${start.toISOString()}::timestamptz and done_at < ${end.toISOString()}::timestamptz`),
  ]);
  return { leads: a.leads, consults_held: a.consults_held, enrolments: a.enrolments, cash_egp: a.cash_egp, tasks_done: Number(t.n) };
}

/** Rolling 7 days up to now, and the 7 days before, so the comparison never depends on the weekday. */
export async function pulse(db: Db, now = new Date()): Promise<Pulse> {
  const day = 86_400_000;
  const [cur, prev] = await Promise.all([window(db, new Date(now.getTime() - 7 * day), now), window(db, new Date(now.getTime() - 14 * day), new Date(now.getTime() - 7 * day))]);
  return Object.fromEntries(PULSE.map(({ key }) => [key, { now: cur[key], before: prev[key] }])) as Pulse;
}

// ---------------- alerts: everything that needs a person, in one list ----------------

export type Alert = { key: string; severity: "danger" | "warn" | "info"; title: string; detail: string; count: number; href: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function alerts(db: Db, role: Role, now = new Date()): Promise<Alert[]> {
  const settings = await getSettings(db);
  const today = startOfCairoDay(now).toISOString();
  const redBefore = new Date(now.getTime() - settings.slaRedMin * 60_000).toISOString();
  const soon = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const money = can(role, "finance:read");
  const owner = can(role, "settings:write");

  const [counts, [r], batches, [lastRun], progress] = await Promise.all([
    navCounts(db, now),
    db.execute<{ past_red: number; tasks_overdue: number; instalments_overdue: number; instalments_egp: number; owed_overdue: number; replies: number }>(sql`
      select
        (select count(*) from leads l join stages s on s.key = l.stage
          where l.deleted_at is null and s.kind = 'open' and l.first_contact_at is null and not l.do_not_contact
            and l.created_at < ${redBefore}::timestamptz)::int as past_red,
        (select count(*) from follow_ups f join leads l on l.id = f.lead_id
          where f.kind = 'reply' and f.done_at is null and f.cancelled_at is null and l.deleted_at is null)::int as replies,
        (select count(*) from tasks where done_at is null and cancelled_at is null and due_at < ${today}::timestamptz)::int as tasks_overdue,
        (select count(*) from ledger_entries x left join enrolments e on e.id = x.enrolment_id
          where x.deleted_at is null and x.section = 'income' and x.status = 'expected' and x.date < ${today}::timestamptz
            and e.status is distinct from 'dropped')::int as instalments_overdue,
        (select coalesce(sum(x.amount_egp), 0) from ledger_entries x left join enrolments e on e.id = x.enrolment_id
          where x.deleted_at is null and x.section = 'income' and x.status = 'expected' and x.date < ${today}::timestamptz
            and e.status is distinct from 'dropped')::int as instalments_egp,
        (select count(*) from ledger_entries where deleted_at is null and status = 'owed' and date < ${today}::timestamptz)::int as owed_overdue`),
    db.execute<{ id: number; name: string; seat_cap: number; used: number; close_at: string }>(sql`
      select c.id, c.name, c.seat_cap, count(e.id)::int as used, c.enrolment_close_at as close_at
      from cohorts c left join enrolments e on e.cohort_id = c.id and e.status is distinct from 'dropped'
      where c.status <> 'closed' and c.enrolment_close_at >= ${now.toISOString()}::timestamptz and c.enrolment_close_at < ${soon}::timestamptz
      group by c.id order by c.enrolment_close_at limit 3`),
    db.select().from(notionSyncRuns).orderBy(desc(notionSyncRuns.id)).limit(1),
    progressFor(db, quarterOf(now), now),
  ]);

  const out: Alert[] = [];
  const add = (a: Alert) => a.count > 0 && out.push(a);
  const v = counts.views;
  add({ key: "past_red", severity: "danger", title: "Leads waiting past the red time", detail: `${plural(Number(r.past_red), "new lead")} not contacted after ${settings.slaRedMin} minutes`, count: Number(r.past_red), href: "/leads?view=uncontacted" });
  add({ key: "replies", severity: "danger", title: "Replies waiting on us", detail: `${plural(Number(r.replies), "lead")} answered and wait for a reply`, count: Number(r.replies), href: "/" });
  add({ key: "followups", severity: "warn", title: "Overdue follow-ups", detail: `${plural(counts.overdue, "follow-up")} past their day`, count: counts.overdue, href: "/" });
  add({ key: "decision_due", severity: "warn", title: "Decisions due", detail: `${plural(v.decision_due, "offer")} at or past the agreed decision date`, count: v.decision_due, href: "/leads?view=decision_due" });
  add({ key: "no_next_step", severity: "warn", title: "Leads with no next step", detail: `${plural(v.no_next_step, "open lead")} with nothing scheduled`, count: v.no_next_step, href: "/leads?view=no_next_step" });
  add({ key: "neglected", severity: "info", title: "Neglected leads", detail: `no activity for ${settings.neglectDays}+ days`, count: v.neglected, href: "/leads?view=neglected" });
  add({ key: "tasks_overdue", severity: "warn", title: "Overdue tasks", detail: `${plural(Number(r.tasks_overdue), "task")} past due across the team`, count: Number(r.tasks_overdue), href: "/tasks?who=all&due=overdue" });
  if (money) {
    add({ key: "instalments", severity: "danger", title: "Overdue instalments", detail: `${plural(Number(r.instalments_overdue), "payment")}, ${new Intl.NumberFormat("en-US").format(Number(r.instalments_egp))} EGP expected and not received`, count: Number(r.instalments_overdue), href: "/finance" });
    add({ key: "owed", severity: "warn", title: "Bills past due", detail: `${plural(Number(r.owed_overdue), "cost")} marked Owed with a date in the past`, count: Number(r.owed_overdue), href: "/finance/ledger" });
  }
  for (const b of batches) {
    const left = Number(b.seat_cap) - Number(b.used);
    if (left > 0)
      add({ key: `batch_${b.id}`, severity: "info", title: `${b.name}: enrolment closes soon`, detail: `${plural(left, "seat")} left, closes ${cairoYmd(new Date(b.close_at))}`, count: left, href: `/cohorts/${b.id}` });
  }
  for (const t of progress.rows) {
    if ((t.status === "behind" || t.status === "at_risk") && (!t.money || money))
      add({ key: `target_${t.metric}`, severity: t.status === "behind" ? "warn" : "info", title: `${t.label} ${t.status === "behind" ? "behind" : "at risk"} for ${progress.period}`, detail: `${t.actual} of ${t.target}; about ${t.expected} expected by now`, count: 1, href: "/command#targets" });
  }
  if (owner && lastRun && lastRun.errors.length)
    add({ key: "notion", severity: "info", title: "Notion sync reported problems", detail: `${plural(lastRun.errors.length, "problem")} in the last run`, count: lastRun.errors.length, href: "/settings/integrations" });
  const order = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ---------------- weekly review ----------------

/** The Monday (Cairo calendar) of the week a moment falls in. */
export function weekStartOf(d: Date): string {
  const ymd = cairoYmd(d);
  const weekday = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDaysYmd(ymd, -weekday);
}

export const isWeek = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && weekStartOf(cairoLocalToDate(`${v}T12:00`) ?? new Date(NaN)) === v;

export async function weekNumbers(db: Db, weekStart: string): Promise<Record<PulseKey, number>> {
  const start = cairoLocalToDate(`${weekStart}T00:00`)!;
  const end = cairoLocalToDate(`${addDaysYmd(weekStart, 7)}T00:00`)!;
  return window(db, start, end);
}

export async function getReview(db: Db, weekStart: string) {
  const [r] = await db.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart));
  return r ?? null;
}

export async function listReviews(db: Db, limit = 12) {
  return db.select().from(weeklyReviews).orderBy(desc(weeklyReviews.weekStart)).limit(limit);
}

export async function saveReview(
  db: Db,
  weekStart: string,
  input: { wins?: string | null; misses?: string | null; decisions?: string | null; notes?: string | null },
  userId: number | null,
) {
  if (!isWeek(weekStart)) return { ok: false as const, error: "Pick the Monday of a week" };
  const clean = (s: string | null | undefined) => (s?.trim() ? s.trim().slice(0, 8000) : null);
  const values = { wins: clean(input.wins), misses: clean(input.misses), decisions: clean(input.decisions), notes: clean(input.notes) };
  const snapshot = await weekNumbers(db, weekStart);
  await db
    .insert(weeklyReviews)
    .values({ weekStart, ...values, snapshot, updatedBy: userId })
    .onConflictDoUpdate({ target: weeklyReviews.weekStart, set: { ...values, snapshot, updatedBy: userId, updatedAt: new Date() } });
  await audit(db, { userId, entity: "weekly_review", entityId: weekStart, action: "save" });
  return { ok: true as const };
}

