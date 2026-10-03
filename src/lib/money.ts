import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { budgets } from "@/db/schema";
import { audit } from "./audit";
import { SECTIONS, listCandidates, monthRange, shiftMonth } from "./finance";
import { listCohorts } from "./cohorts";
import { addDaysYmd, cairoYmd, startOfCairoDay } from "./time";

type CostSection = "fixed_costs" | "variable_costs";
const COST_SECTIONS: CostSection[] = ["fixed_costs", "variable_costs"];

// ---------------- budget vs actual ----------------

export type BudgetRow = { section: CostSection; category: string; budget: number; paid: number; owed: number; left: number; over: boolean; unplanned: boolean };

/**
 * Each cost category for the month: the budget, what was paid and what is owed (ledger rows dated in the month),
 * and what is left. Over = paid + owed above a budget; unplanned = spent with no budget at all.
 */
export async function budgetVsActual(db: Db, month: string): Promise<{ rows: BudgetRow[]; totals: { budget: number; paid: number; owed: number; left: number } }> {
  const [start, end] = monthRange(month);
  const [plan, spent] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.month, month)),
    db.execute<{ section: CostSection; category: string; paid: number; owed: number }>(sql`
      select section, category,
        coalesce(sum(amount_egp) filter (where status = 'paid'), 0)::int as paid,
        coalesce(sum(amount_egp) filter (where status = 'owed'), 0)::int as owed
      from ledger_entries
      where deleted_at is null and section in ('fixed_costs', 'variable_costs')
        and coalesce(date, created_at) >= ${start.toISOString()}::timestamptz and coalesce(date, created_at) < ${end.toISOString()}::timestamptz
      group by section, category`),
  ]);
  const key = (s: string, c: string) => `${s}|${c}`;
  const cats = new Map<string, { section: CostSection; category: string }>();
  for (const s of COST_SECTIONS) for (const c of SECTIONS[s].categories) cats.set(key(s, c), { section: s, category: c });
  for (const p of plan) cats.set(key(p.section, p.category), { section: p.section as CostSection, category: p.category });
  for (const x of spent) cats.set(key(x.section, x.category), { section: x.section, category: x.category });
  const planBy = new Map(plan.map((p) => [key(p.section, p.category), p.amountEgp]));
  const spentBy = new Map([...spent].map((x) => [key(x.section, x.category), { paid: Number(x.paid), owed: Number(x.owed) }]));
  const rows = [...cats.values()].map((c): BudgetRow => {
    const budget = planBy.get(key(c.section, c.category)) ?? 0;
    const { paid, owed } = spentBy.get(key(c.section, c.category)) ?? { paid: 0, owed: 0 };
    return { ...c, budget, paid, owed, left: budget - paid - owed, over: budget > 0 && paid + owed > budget, unplanned: budget === 0 && paid + owed > 0 };
  });
  const sum = (f: (r: BudgetRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, totals: { budget: sum((r) => r.budget), paid: sum((r) => r.paid), owed: sum((r) => r.owed), left: sum((r) => r.left) } };
}

/** Set the month's budget; a zero (or empty) amount removes that line. */
export async function saveBudget(db: Db, month: string, lines: { section: CostSection; category: string; amountEgp: number }[], userId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Pick the month" };
  for (const l of lines) {
    if (!COST_SECTIONS.includes(l.section) || !l.category.trim() || l.category.length > 80) return { ok: false, error: "Unknown cost category" };
    if (!Number.isInteger(l.amountEgp) || l.amountEgp < 0 || l.amountEgp > 100_000_000) return { ok: false, error: `${l.category}: a whole number of EGP` };
  }
  await db.transaction(async (tx) => {
    for (const l of lines) {
      const where = and(eq(budgets.month, month), eq(budgets.section, l.section), eq(budgets.category, l.category.trim()));
      if (!l.amountEgp) await tx.delete(budgets).where(where);
      else
        await tx
          .insert(budgets)
          .values({ month, section: l.section, category: l.category.trim(), amountEgp: l.amountEgp, updatedBy: userId })
          .onConflictDoUpdate({ target: [budgets.month, budgets.section, budgets.category], set: { amountEgp: l.amountEgp, updatedBy: userId, updatedAt: new Date() } });
    }
    await audit(tx, { userId, entity: "budget", entityId: month, action: "save", diff: { lines: lines.length } });
  });
  return { ok: true };
}

/** Start a month from the previous one's budget (only lines the month does not have yet). */
export async function copyBudget(db: Db, month: string, userId: number | null) {
  const from = shiftMonth(month, -1);
  const r = await db.execute(sql`
    insert into budgets (month, section, category, amount_egp, updated_by)
    select ${month}, section, category, amount_egp, ${userId} from budgets where month = ${from}
    on conflict do nothing`);
  await audit(db, { userId, entity: "budget", entityId: month, action: "copy", diff: { from } });
  return { ok: true as const, copied: r.count ?? 0 };
}

// ---------------- cash forecast ----------------

export type ForecastWeek = { start: string; in: number; out: number; planned: number; net: number; running: number };

/**
 * The next `weeks` weeks of money, week by week from today (Cairo days): money expected in (instalments due,
 * open invoices), money owed out (costs, withdrawals, refunds due), and what is left of each month's budget that
 * is not booked yet, spread evenly over the month's remaining days. Running = opening + net so far.
 * Rows dated before today and still open are "late": shown apart, not assumed.
 */
export async function cashForecast(db: Db, opts: { weeks?: number; opening?: number; now?: Date } = {}) {
  const weeks = opts.weeks ?? 13;
  const now = opts.now ?? new Date();
  const today = cairoYmd(now);
  const start = startOfCairoDay(now);
  const endYmd = addDaysYmd(today, weeks * 7);
  const end = startOfCairoDay(new Date(Date.parse(`${endYmd}T12:00:00Z`)));
  const rows = await db.execute<{ day: string; kind: "in" | "out"; amount: number }>(sql`
    select to_char(coalesce(l.date, l.created_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day,
      case when l.section = 'income' and l.category <> 'Refund' then 'in' else 'out' end as kind,
      sum(l.amount_egp)::int as amount
    from ledger_entries l left join enrolments e on e.id = l.enrolment_id
    where l.deleted_at is null and l.status in ('expected', 'owed') and e.status is distinct from 'dropped'
      and coalesce(l.date, l.created_at) < ${end.toISOString()}::timestamptz
    group by 1, 2`);
  const late = { in: 0, out: 0 };
  const byWeek = Array.from({ length: weeks }, (_, i) => ({ start: addDaysYmd(today, i * 7), in: 0, out: 0, planned: 0 }));
  const weekOf = (day: string) => Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000));
  for (const r of rows) {
    const amount = Number(r.amount);
    if (r.day < today) late[r.kind] += amount;
    else {
      const w = weekOf(r.day);
      if (w >= 0 && w < weeks) byWeek[w][r.kind] += amount;
    }
  }
  // what is left of each month's budget, not yet booked, spread over the month's days from today on
  const months: string[] = [];
  for (let m = today.slice(0, 7); m <= endYmd.slice(0, 7); m = shiftMonth(m, 1)) months.push(m);
  for (const m of months) {
    const bva = await budgetVsActual(db, m);
    const left = bva.rows.reduce((a, r) => a + Math.max(0, r.left), 0);
    if (!left) continue;
    const days: string[] = [];
    for (let d = m === today.slice(0, 7) ? today : `${m}-01`; d.slice(0, 7) === m; d = addDaysYmd(d, 1)) days.push(d);
    const perDay = left / days.length;
    for (const d of days) {
      const w = weekOf(d);
      if (w >= 0 && w < weeks) byWeek[w].planned += perDay;
    }
  }
  let running = opts.opening ?? 0;
  const out: ForecastWeek[] = byWeek.map((w) => {
    const planned = Math.round(w.planned);
    const net = w.in - w.out - planned;
    running += net;
    return { start: w.start, in: w.in, out: w.out, planned, net, running };
  });
  return { weeks: out, late, totals: { in: out.reduce((a, w) => a + w.in, 0), out: out.reduce((a, w) => a + w.out, 0), planned: out.reduce((a, w) => a + w.planned, 0) }, hasOpening: opts.opening !== undefined, start };
}

// ---------------- unit economics ----------------

export const MARKETING_CATEGORIES = ["Ads & promotion", "Referral rewards"];

/**
 * Per batch: students, what they owe in total (revenue), what came in, the costs tagged to the batch and the
 * margin. Per production case type (cases delivered in the period): revenue, designer pay, margin.
 * Marketing over the period: spend (ads, referral rewards and any cost tagged to a campaign), new leads,
 * enrolments, cost per lead and per enrolment.
 */
export async function unitEconomics(db: Db, period: { from: Date; to: Date }) {
  const [cands, batches, batchCosts, cases, mkt] = await Promise.all([
    listCandidates(db),
    listCohorts(db),
    db.execute<{ cohort_id: number; costs: number }>(sql`
      select cohort_id, sum(amount_egp)::int as costs from ledger_entries
      where deleted_at is null and cohort_id is not null and section in ('fixed_costs', 'variable_costs') and status in ('paid', 'owed')
      group by cohort_id`),
    db.execute<{ type: string; cases: number; units: number; revenue: number; pay: number }>(sql`
      select t.name as type, count(*)::int as cases, sum(c.units)::int as units, sum(c.price_egp)::int as revenue, sum(c.designer_pay_egp)::int as pay
      from production_cases c join case_types t on t.id = c.case_type_id
      where c.delivered_at >= ${period.from.toISOString()}::timestamptz and c.delivered_at < ${period.to.toISOString()}::timestamptz
      group by t.name order by revenue desc`),
    db.execute<{ spend: number; leads: number; enrolments: number; revenue: number }>(sql`
      select
        (select coalesce(sum(amount_egp), 0) from ledger_entries where deleted_at is null and status = 'paid' and section in ('fixed_costs', 'variable_costs')
          and (category in (${sql.join(MARKETING_CATEGORIES.map((c) => sql`${c}`), sql`, `)}) or campaign_id is not null)
          and coalesce(date, created_at) >= ${period.from.toISOString()}::timestamptz and coalesce(date, created_at) < ${period.to.toISOString()}::timestamptz)::int as spend,
        (select count(*) from leads where deleted_at is null and created_at >= ${period.from.toISOString()}::timestamptz and created_at < ${period.to.toISOString()}::timestamptz)::int as leads,
        (select count(*) from enrolments where created_at >= ${period.from.toISOString()}::timestamptz and created_at < ${period.to.toISOString()}::timestamptz)::int as enrolments,
        (select coalesce(sum(case when payment_plan = 'free_seat' then 0 else amount_egp - discount_egp end), 0) from enrolments
          where created_at >= ${period.from.toISOString()}::timestamptz and created_at < ${period.to.toISOString()}::timestamptz)::int as revenue`),
  ]);
  const costBy = new Map([...batchCosts].map((r) => [Number(r.cohort_id), Number(r.costs)]));
  const perBatch = batches
    .map((b) => {
      const mine = cands.filter((c) => c.cohortId === b.id);
      const students = mine.filter((c) => c.status !== "dropped").length;
      const revenue = mine.reduce((a, c) => a + c.due, 0);
      const received = mine.reduce((a, c) => a + c.paid, 0);
      const costs = costBy.get(b.id) ?? 0;
      return { id: b.id, name: b.name, seatCap: b.seatCap, students, revenue, received, costs, margin: revenue - costs, marginPct: revenue ? (revenue - costs) / revenue : null, perStudent: students ? Math.round(revenue / students) : null };
    })
    .filter((b) => b.students > 0 || b.costs > 0);
  const perCaseType = [...cases].map((r) => {
    const revenue = Number(r.revenue);
    const pay = Number(r.pay);
    return { type: String(r.type), cases: Number(r.cases), units: Number(r.units), revenue, pay, margin: revenue - pay, marginPct: revenue ? (revenue - pay) / revenue : null, avgPrice: Number(r.cases) ? Math.round(revenue / Number(r.cases)) : 0 };
  });
  const [m] = [...mkt];
  const spend = Number(m.spend), leadsN = Number(m.leads), enrolN = Number(m.enrolments), rev = Number(m.revenue);
  return {
    perBatch,
    perCaseType,
    marketing: { spend, leads: leadsN, enrolments: enrolN, costPerLead: leadsN && spend ? Math.round(spend / leadsN) : null, costPerEnrolment: enrolN && spend ? Math.round(spend / enrolN) : null, revenuePerEnrolment: enrolN ? Math.round(rev / enrolN) : null },
  };
}
