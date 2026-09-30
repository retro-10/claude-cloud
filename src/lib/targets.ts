import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { targets } from "@/db/schema";
import { audit } from "./audit";
import { dueFor } from "./finance";
import { cairoLocalToDate, cairoYmd } from "./time";

export const TARGET_METRICS = {
  leads: { label: "New leads", unit: "count", money: false, hint: "leads added in the quarter" },
  consults_held: { label: "Consults held", unit: "count", money: false, hint: "consults marked held, by their date" },
  enrolments: { label: "Enrolments", unit: "count", money: false, hint: "students enrolled in the quarter" },
  revenue_egp: { label: "Revenue", unit: "egp", money: true, hint: "what the quarter's new students owe (dropped: what they paid)" },
  cash_egp: { label: "Cash collected", unit: "egp", money: true, hint: "income received in the quarter, less refunds" },
} as const;
export type TargetMetric = keyof typeof TARGET_METRICS;
export const TARGET_KEYS = Object.keys(TARGET_METRICS) as TargetMetric[];

const PERIOD = /^(\d{4})-Q([1-4])$/;

/** The Cairo calendar quarter a moment falls in, e.g. "2026-Q4". */
export function quarterOf(d: Date): string {
  const [y, m] = cairoYmd(d).split("-").map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

export function shiftQuarter(period: string, by: number): string {
  const [, y, q] = period.match(PERIOD)!;
  const i = Number(y) * 4 + Number(q) - 1 + by;
  return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
}

/** [start, end) of a quarter at Cairo midnight. */
export function quarterRange(period: string): [Date, Date] {
  const m = period.match(PERIOD);
  if (!m) throw new Error(`bad period ${period}`);
  const y = Number(m[1]);
  const first = (Number(m[2]) - 1) * 3 + 1;
  const start = cairoLocalToDate(`${y}-${String(first).padStart(2, "0")}-01T00:00`)!;
  const endMonth = first + 3;
  const end = endMonth > 12 ? cairoLocalToDate(`${y + 1}-01-01T00:00`)! : cairoLocalToDate(`${y}-${String(endMonth).padStart(2, "0")}-01T00:00`)!;
  return [start, end];
}

export const isPeriod = (p: unknown): p is string => typeof p === "string" && PERIOD.test(p);

/** What actually happened between two moments, for every target metric. */
export async function actuals(db: Db, start: Date, end: Date): Promise<Record<TargetMetric, number>> {
  const a = start.toISOString(), b = end.toISOString();
  const [r] = await db.execute<Record<TargetMetric, number>>(sql`
    select
      (select count(*) from leads where deleted_at is null and created_at >= ${a}::timestamptz and created_at < ${b}::timestamptz)::int as leads,
      (select count(*) from consults c join leads l on l.id = c.lead_id where l.deleted_at is null and c.held
         and c.scheduled_at >= ${a}::timestamptz and c.scheduled_at < ${b}::timestamptz)::int as consults_held,
      (select count(*) from enrolments e where e.created_at >= ${a}::timestamptz and e.created_at < ${b}::timestamptz)::int as enrolments,
      (select coalesce(sum(${dueFor("e")}), 0) from enrolments e where e.created_at >= ${a}::timestamptz and e.created_at < ${b}::timestamptz)::int as revenue_egp,
      (select coalesce(sum(case when category = 'Refund' then -amount_egp else amount_egp end), 0) from ledger_entries
         where deleted_at is null and section = 'income' and status = 'received'
         and coalesce(date, created_at) >= ${a}::timestamptz and coalesce(date, created_at) < ${b}::timestamptz)::int as cash_egp`);
  return Object.fromEntries(TARGET_KEYS.map((k) => [k, Number(r[k] ?? 0)])) as Record<TargetMetric, number>;
}

export type TargetProgress = {
  metric: TargetMetric;
  label: string;
  unit: "count" | "egp";
  money: boolean;
  hint: string;
  target: number | null;
  actual: number;
  /** where the actual should be by now if the quarter ran evenly */
  expected: number | null;
  pct: number | null;
  status: "done" | "on_track" | "at_risk" | "behind" | "no_target" | "ended_short";
};

/** Every metric for a quarter: its target (if any), the actual so far, and whether it is on pace. */
export async function progressFor(db: Db, period: string, now = new Date()): Promise<{ period: string; elapsed: number; rows: TargetProgress[] }> {
  const [start, end] = quarterRange(period);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
  const [set, act] = await Promise.all([db.select().from(targets).where(eq(targets.period, period)), actuals(db, start, end)]);
  const rows = TARGET_KEYS.map((metric): TargetProgress => {
    const def = TARGET_METRICS[metric];
    const target = set.find((t) => t.metric === metric)?.value ?? null;
    const actual = act[metric];
    const base = { metric, label: def.label, unit: def.unit, money: def.money, hint: def.hint, actual };
    if (!target) return { ...base, target: null, expected: null, pct: null, status: "no_target" };
    const expected = Math.round(target * elapsed);
    const status = actual >= target ? "done" : elapsed >= 1 ? "ended_short" : actual >= expected ? "on_track" : actual >= expected * 0.8 ? "at_risk" : "behind";
    return { ...base, target, expected, pct: Math.round((actual / target) * 100), status };
  });
  return { period, elapsed, rows };
}

/** Sets a target; an empty value or 0 removes it. Owners only (checked by the caller). */
export async function saveTarget(db: Db, metric: TargetMetric, period: string, value: number | null, userId: number | null) {
  if (!TARGET_KEYS.includes(metric) || !isPeriod(period)) return { ok: false as const, error: "Unknown target" };
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000_000)) return { ok: false as const, error: "A target is a whole number" };
  if (!value) {
    await db.delete(targets).where(and(eq(targets.metric, metric), eq(targets.period, period)));
  } else {
    await db
      .insert(targets)
      .values({ metric, period, value, updatedBy: userId })
      .onConflictDoUpdate({ target: [targets.metric, targets.period], set: { value, updatedBy: userId, updatedAt: new Date() } });
  }
  await audit(db, { userId, entity: "target", entityId: `${period}:${metric}`, action: value ? "set" : "clear", diff: { value } });
  return { ok: true as const };
}
