import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { businessFunctions, cycleCloses, ledgerEntries, legacyMovements, partnerReviews, payRuns } from "@/db/schema";
import { getSettings, type Settings } from "./app-settings";
import { audit } from "./audit";
import { effectiveDate, monthRange, shiftMonth } from "./finance";
import type { FinanceModel } from "./finance-model";
import { addDaysYmd, cairoLocalToDate, cairoYmd } from "./time";

// The rebuild's money rules, computed from the ledger:
//  * the OLD cycle (up to the close date): income is split per stream (Camp, Core) between the partners and
//    Capital; Capital pays every cost; partners' withdrawals come off their share. At the close, Capital's
//    shortfall is spread over the partners at their old Camp percentages scaled to 100%, and what is left is each
//    partner's legacy balance, kept in a separate legacy ledger and settled later.
//  * the NEW cycle (after the close), each month: costs first, then the cash reserve, then partner base pay
//    (unlocked by income tiers), then KPI pay from the partner review, then 20% retained and the rest shared
//    equally. Pay due to a partner who owes the legacy ledger is withheld toward it.
// All figures are EGP. The workbook rounds to the nearest pound only at the end; so does this.

const r0 = (x: number) => Math.round(x);
const endOfDay = (ymd: string) => cairoLocalToDate(`${addDaysYmd(ymd, 1)}T00:00`)!;

type Flow = { section: string; category: string; status: string; partner: string | null; stream: string; amount: number };

async function flows(db: Db, where?: SQL): Promise<Flow[]> {
  const rows = await db
    .select({
      section: ledgerEntries.section,
      category: ledgerEntries.category,
      status: ledgerEntries.status,
      partner: ledgerEntries.partner,
      stream: ledgerEntries.stream,
      amount: sql<number>`sum(${ledgerEntries.amountEgp})::int`,
    })
    .from(ledgerEntries)
    .where(and(isNull(ledgerEntries.deletedAt), where))
    .groupBy(ledgerEntries.section, ledgerEntries.category, ledgerEntries.status, ledgerEntries.partner, ledgerEntries.stream);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

const moved = (f: Flow) => f.status === "received" || f.status === "paid";
const pending = (f: Flow) => f.status === "expected" || f.status === "owed";
/** Income counted net of refunds (a refund is income going back out). */
const income = (fs: Flow[], keep: (f: Flow) => boolean, stream?: string) =>
  fs.filter((f) => f.section === "income" && keep(f) && (!stream || f.stream === stream)).reduce((a, f) => a + (f.category === "Refund" ? -f.amount : f.amount), 0);
const costs = (fs: Flow[], keep: (f: Flow) => boolean) => fs.filter((f) => (f.section === "fixed_costs" || f.section === "variable_costs") && keep(f)).reduce((a, f) => a + f.amount, 0);
const drawn = (fs: Flow[], keep: (f: Flow) => boolean, partner?: string) =>
  fs.filter((f) => f.section === "partner_withdrawals" && keep(f) && (!partner || f.partner === partner)).reduce((a, f) => a + f.amount, 0);

/** Cash in the business at an instant: everything received, less everything paid out (old and new cycle). */
export async function cashAt(db: Db, at: Date) {
  const fs = await flows(db, sql`${effectiveDate} < ${at.toISOString()}::timestamptz`);
  return income(fs, moved) - costs(fs, moved) - drawn(fs, moved);
}

// ---------------- the old cycle and its settlement ----------------

export type Holder = {
  name: string;
  campPct: number;
  corePct: number;
  share: number; // of income
  drawn: number; // withdrawals (for Capital: all business costs)
  balance: number;
  weight: number; // share of Capital's shortfall
  shortfall: number; // their part of it (negative)
  settled: number; // balance after settlement
};

export type Position = {
  campIncome: number;
  coreIncome: number;
  income: number;
  costs: number;
  withdrawals: number;
  cash: number;
  holders: Holder[]; // the partners, then Capital last
  owedToPartners: number;
  owedByPartners: number;
  check: boolean; // balances after settlement add up to the cash
};

function position(fs: Flow[], keep: (f: Flow) => boolean, s: Settings): Position {
  const camp = s.financeSplit;
  const core = s.financeModel.coreSplit;
  const campIncome = income(fs, keep, "camp");
  const coreIncome = income(fs, keep, "core");
  const totalCosts = costs(fs, keep);
  const capitalCamp = camp.capitalPct / 100;
  const holders: Holder[] = camp.partners.map((p) => {
    const corePct = core.partners.find((c) => c.name === p.name)?.pct ?? 0;
    const share = (p.pct / 100) * campIncome + (corePct / 100) * coreIncome;
    const d = drawn(fs, keep, p.name);
    return { name: p.name, campPct: p.pct, corePct, share, drawn: d, balance: share - d, weight: capitalCamp < 1 ? p.pct / 100 / (1 - capitalCamp) : 0, shortfall: 0, settled: 0 };
  });
  const capShare = capitalCamp * campIncome + (core.capitalPct / 100) * coreIncome;
  const capital: Holder = { name: "Capital", campPct: camp.capitalPct, corePct: core.capitalPct, share: capShare, drawn: totalCosts, balance: capShare - totalCosts, weight: 0, shortfall: 0, settled: 0 };
  const gap = Math.max(0, -capital.balance);
  for (const h of holders) {
    h.shortfall = -h.weight * gap;
    h.settled = h.balance + h.shortfall;
  }
  capital.shortfall = gap;
  capital.settled = capital.balance + gap;
  const all = [...holders, capital];
  const cash = income(fs, keep) - totalCosts - drawn(fs, keep);
  const total = all.reduce((a, h) => a + h.settled, 0);
  return {
    campIncome,
    coreIncome,
    income: campIncome + coreIncome,
    costs: totalCosts,
    withdrawals: drawn(fs, keep),
    cash,
    holders: all,
    owedToPartners: holders.filter((h) => h.settled > 0).reduce((a, h) => a + h.settled, 0),
    owedByPartners: -holders.filter((h) => h.settled < 0).reduce((a, h) => a + h.settled, 0),
    check: Math.round(total - cash) === 0,
  };
}

export type OldCycle = { closeDate: string; today: Position; atClose: Position; closed: typeof cycleCloses.$inferSelect | null };

/**
 * The old cycle as of now ("today": only money that moved) and as it will stand at the close (Expected and Owed
 * rows included). Null when no close date is set.
 */
export async function oldCycle(db: Db): Promise<OldCycle | null> {
  const s = await getSettings(db);
  const closeDate = s.financeModel.closeDate;
  if (!closeDate) return null;
  const end = endOfDay(closeDate);
  const [fs, [closed]] = await Promise.all([
    flows(db, sql`${effectiveDate} < ${end.toISOString()}::timestamptz`),
    db.select().from(cycleCloses).where(eq(cycleCloses.closeDate, closeDate)).limit(1),
  ]);
  return { closeDate, today: position(fs, moved, s), atClose: position(fs, (f) => moved(f) || pending(f), s), closed: closed ?? null };
}

/**
 * Closes the old cycle: keeps the settlement as it stands and opens each partner's legacy balance (rounded to the
 * nearest pound, as the plan does). Once per close date; only on or after it.
 */
export async function closeCycle(db: Db, userId: number | null, now = new Date()): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const c = await oldCycle(db);
  if (!c) return { ok: false, error: "Set the close date first (Settings > Finance model)" };
  if (c.closed) return { ok: false, error: `The cycle that ends ${c.closeDate} is already closed` };
  if (cairoYmd(now) <= c.closeDate) return { ok: false, error: `The cycle can be closed from the day after ${c.closeDate}` };
  const p = c.atClose;
  const pendingRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(and(isNull(ledgerEntries.deletedAt), sql`${ledgerEntries.status} in ('expected', 'owed')`, sql`${effectiveDate} < ${endOfDay(c.closeDate).toISOString()}::timestamptz`));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cycleCloses)
      .values({ closeDate: c.closeDate, snapshot: { ...p, pendingRows: Number(pendingRows[0].n), rule: "old split, Capital pays costs, shortfall by old Camp shares" }, closedBy: userId })
      .returning({ id: cycleCloses.id });
    for (const h of p.holders.filter((x) => x.name !== "Capital")) {
      const amount = r0(h.settled);
      if (amount !== 0) await tx.insert(legacyMovements).values({ partner: h.name, kind: "opening", amountEgp: amount, cycleCloseId: row.id, note: `Old cycle settled at the ${c.closeDate} close`, createdBy: userId });
    }
    await audit(tx, { userId, entity: "cycle", entityId: row.id, action: "close", diff: { closeDate: c.closeDate, cash: r0(p.cash) } });
    return { ok: true as const, id: row.id };
  });
}

// ---------------- the legacy ledger ----------------

export async function legacyBalances(db: Db): Promise<{ partner: string; balance: number }[]> {
  const rows = await db
    .select({ partner: legacyMovements.partner, balance: sql<number>`sum(${legacyMovements.amountEgp})::int` })
    .from(legacyMovements)
    .groupBy(legacyMovements.partner);
  return rows.map((r) => ({ partner: r.partner, balance: Number(r.balance) }));
}

export async function legacyHistory(db: Db) {
  return db.select().from(legacyMovements).orderBy(desc(legacyMovements.createdAt), desc(legacyMovements.id)).limit(200);
}

/**
 * Pays part of a legacy balance: a payment to a partner the company owes (cash out, booked in the ledger), a
 * repayment by a partner who owes the company (cash in), or an adjustment the partners agreed (no cash).
 */
export async function recordLegacy(
  db: Db,
  input: { partner: string; kind: "payment" | "adjustment"; amountEgp: number; note?: string | null; date?: string | null },
  userId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSettings(db);
  if (!s.financeSplit.partners.some((p) => p.name === input.partner)) return { ok: false, error: "Choose a partner" };
  if (!Number.isInteger(input.amountEgp) || input.amountEgp === 0 || Math.abs(input.amountEgp) > 100_000_000) return { ok: false, error: "Give a whole amount of EGP" };
  const bal = (await legacyBalances(db)).find((b) => b.partner === input.partner)?.balance ?? 0;
  const note = input.note?.trim().slice(0, 300) || null;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? cairoLocalToDate(`${input.date}T12:00`) : new Date();
  return db.transaction(async (tx) => {
    if (input.kind === "payment") {
      // amount is what moved: positive. Paid to a partner who is owed, or received from one who owes.
      const amount = Math.abs(input.amountEgp);
      if (bal === 0) return { ok: false as const, error: `${input.partner} has no legacy balance` };
      if (amount > Math.abs(bal)) return { ok: false as const, error: `That is more than the ${Math.abs(bal).toLocaleString("en-US")} EGP balance` };
      const owedToPartner = bal > 0;
      const [e] = await tx
        .insert(ledgerEntries)
        .values({
          entry: owedToPartner ? `Legacy settlement to ${input.partner}` : `Legacy repayment from ${input.partner}`,
          amountEgp: amount,
          date,
          section: owedToPartner ? "partner_withdrawals" : "income",
          category: owedToPartner ? "Legacy settlement" : "Legacy repayment",
          status: owedToPartner ? "paid" : "received",
          partner: owedToPartner ? input.partner : null,
          notes: note,
          createdBy: userId,
        })
        .returning({ id: ledgerEntries.id });
      await tx.insert(legacyMovements).values({ partner: input.partner, kind: "payment", amountEgp: owedToPartner ? -amount : amount, note, ledgerEntryId: e.id, createdBy: userId });
    } else {
      await tx.insert(legacyMovements).values({ partner: input.partner, kind: "adjustment", amountEgp: input.amountEgp, note, createdBy: userId });
    }
    await audit(tx, { userId, entity: "legacy", action: input.kind, diff: { partner: input.partner, amountEgp: input.amountEgp } });
    return { ok: true as const };
  });
}

// ---------------- pay: tiers, salaries, the monthly waterfall ----------------

export const fixedTotal = (m: FinanceModel) => m.fixedCosts.reduce((a, f) => a + f.amount, 0);
export const reserveTarget = (m: FinanceModel) => fixedTotal(m) * m.reserveMonths;
/** Collected income a month needs, two months running, to unlock a tier: (fixed costs + pool) x 1.25, rounded. */
export const trigger = (m: FinanceModel, pool: number) => Math.round(((fixedTotal(m) + pool) * m.triggerBuffer) / m.triggerRound) * m.triggerRound;

export type FunctionRow = typeof businessFunctions.$inferSelect;

export async function listFunctions(db: Db): Promise<FunctionRow[]> {
  return db.select().from(businessFunctions).where(isNull(businessFunctions.deletedAt)).orderBy(asc(businessFunctions.position), asc(businessFunctions.id));
}

export type FunctionInput = { name: string; appliesTo: string; weight: number; description?: string | null; accountable: string | null; supporting: string[]; staff?: string | null };

/** Adds or changes a function line: one accountable partner (or none yet), any supporting partners. */
export async function saveFunction(db: Db, id: number | null, input: FunctionInput, userId: number | null) {
  const s = await getSettings(db);
  const partners = s.financeModel.newShares.map((p) => p.name);
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false as const, error: "Name the function" };
  if (!["both", "core", "camp"].includes(input.appliesTo)) return { ok: false as const, error: "Choose Both, Core or Camp" };
  if (!(input.weight > 0 && input.weight <= 5)) return { ok: false as const, error: "Weight is between 0 and 5 (0.5 for a split lane)" };
  if (input.accountable && !partners.includes(input.accountable)) return { ok: false as const, error: "Choose a partner" };
  const supporting = [...new Set(input.supporting)].filter((p) => partners.includes(p) && p !== input.accountable);
  const values = {
    name,
    appliesTo: input.appliesTo,
    weight: input.weight,
    description: input.description?.trim().slice(0, 1000) || null,
    accountable: input.accountable || null,
    supporting,
    staff: input.staff?.trim().slice(0, 300) || null,
    updatedBy: userId,
    updatedAt: new Date(),
  };
  if (id) {
    const rows = await db.update(businessFunctions).set(values).where(and(eq(businessFunctions.id, id), isNull(businessFunctions.deletedAt))).returning({ id: businessFunctions.id });
    if (!rows.length) return { ok: false as const, error: "Function not found" };
  } else {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(businessFunctions);
    await db.insert(businessFunctions).values({ ...values, position: Number(n) });
  }
  await audit(db, { userId, entity: "function", entityId: id ?? undefined, action: id ? "update" : "create" });
  return { ok: true as const };
}

export async function removeFunction(db: Db, id: number, userId: number | null) {
  await db.update(businessFunctions).set({ deletedAt: new Date() }).where(eq(businessFunctions.id, id));
  await audit(db, { userId, entity: "function", entityId: id, action: "delete" });
  return { ok: true as const };
}

export type Salary = { name: string; accountable: number; supporting: number; multiplier: number; weighted: number; share: number; x: number[] };

/**
 * Each partner's tier salary X: the pool split by accountable load (weighted) times their multiplier. Every X is
 * rounded to the nearest 100 and the balancing partner takes the difference, so the column adds up to the pool.
 * With no functions recorded, the pool is shared equally.
 */
export function salaries(m: FinanceModel, partners: string[], fns: Pick<FunctionRow, "accountable" | "supporting" | "weight">[]): Salary[] {
  const rows = partners.map((name) => {
    const prof = m.partners.find((p) => p.name === name);
    const accountable = fns.filter((f) => f.accountable === name).reduce((a, f) => a + f.weight, 0);
    const supporting = fns.filter((f) => f.supporting.includes(name)).reduce((a, f) => a + f.weight, 0);
    const multiplier = prof?.multiplier ?? 1;
    return { name, accountable, supporting, multiplier, weighted: accountable * multiplier, balancing: !!prof?.balancing };
  });
  const total = rows.reduce((a, r) => a + r.weighted, 0);
  const share = (r: (typeof rows)[number]) => (total > 0 ? r.weighted / total : 1 / rows.length);
  const balancer = rows.find((r) => r.balancing) ?? rows[rows.length - 1];
  return rows.map((r) => ({
    name: r.name,
    accountable: r.accountable,
    supporting: r.supporting,
    multiplier: r.multiplier,
    weighted: r.weighted,
    share: share(r),
    x: m.tiers.map(({ pool }) => {
      if (r !== balancer) return Math.round((pool * share(r)) / 100) * 100;
      return pool - rows.filter((o) => o !== balancer).reduce((a, o) => a + Math.round((pool * share(o)) / 100) * 100, 0);
    }),
  }));
}

export type PartnerPay = { name: string; x: number; base: number; kpiScore: number | null; kpiEarned: number; kpiPaid: number; distribution: number; due: number; withheld: number; paid: number; legacyBefore: number };

export type Waterfall = {
  month: string;
  from: Date; // the part of the month in the new cycle
  to: Date;
  inNewCycle: boolean;
  income: number;
  costs: number;
  cashAfterCosts: number;
  cashAtStart: number;
  reserveTarget: number;
  reserveTopUp: number;
  tier: number; // 0 = no pay unlocked
  tierIncome: { month: string; income: number }[]; // the months the tier test looked at
  pool: number;
  basePaid: number;
  kpiEarned: number;
  kpiPaid: number;
  profit: number;
  retained: number;
  distributable: number;
  partners: PartnerPay[];
  missingScores: string[];
  approved: typeof payRuns.$inferSelect | null;
};

/** The new-cycle part of a calendar month: from the day after the close, to the month's end. */
function newCycleWindow(m: FinanceModel, month: string): { from: Date; to: Date; inNewCycle: boolean } {
  const [start, end] = monthRange(month);
  if (!m.closeDate) return { from: start, to: end, inNewCycle: true };
  const open = endOfDay(m.closeDate);
  const from = open > start ? open : start;
  return { from, to: end, inNewCycle: from < end };
}

async function collected(db: Db, from: Date, to: Date) {
  if (from >= to) return { income: 0, costs: 0 };
  const fs = await flows(db, sql`${effectiveDate} >= ${from.toISOString()}::timestamptz and ${effectiveDate} < ${to.toISOString()}::timestamptz`);
  // pay runs' own rows and legacy money are not the business's income or costs
  const business = (f: Flow) => moved(f) && !f.category.startsWith("Legacy");
  return { income: income(fs, business), costs: costs(fs, business) };
}

export async function waterfall(db: Db, month: string): Promise<Waterfall> {
  const s = await getSettings(db);
  const m = s.financeModel;
  const partnerNames = (m.newShares.length ? m.newShares : s.financeSplit.partners).map((p) => p.name);
  const win = newCycleWindow(m, month);
  const [flow, cashStart, fns, reviews, legacy, [approved]] = await Promise.all([
    collected(db, win.from, win.to),
    cashAt(db, win.from),
    listFunctions(db),
    db.select().from(partnerReviews).where(eq(partnerReviews.month, month)),
    legacyBalances(db),
    db.select().from(payRuns).where(eq(payRuns.month, month)),
  ]);
  // the tier needs income at or above its trigger this many months running (earlier months before the close count as 0)
  const tierIncome = [{ month, income: flow.income }];
  for (let i = 1; i < m.monthsRunning; i++) {
    const mm = shiftMonth(month, -i);
    const w = newCycleWindow(m, mm);
    tierIncome.push({ month: mm, income: w.inNewCycle ? (await collected(db, w.from, w.to)).income : 0 });
  }
  let tier = 0;
  m.tiers.forEach((t, i) => {
    if (tierIncome.every((x) => x.income >= trigger(m, t.pool))) tier = i + 1;
  });
  const pool = tier ? m.tiers[tier - 1].pool : 0;
  const sal = salaries(m, partnerNames, fns);
  const x = (name: string) => (tier ? (sal.find((p) => p.name === name)?.x[tier - 1] ?? 0) : 0);

  const cashAfterCosts = flow.income - flow.costs;
  const target = reserveTarget(m);
  const reserveTopUp = Math.min(Math.max(0, cashAfterCosts), Math.max(0, target - cashStart));
  const afterReserve = Math.max(0, cashAfterCosts - reserveTopUp);
  const baseDue = pool * m.baseFraction;
  const basePaid = Math.min(baseDue, afterReserve);
  const baseScale = baseDue > 0 ? basePaid / baseDue : 0;
  const score = (name: string) => reviews.find((r) => r.partner === name)?.kpiScore ?? null;
  const kpiEarnedBy = (name: string) => ((score(name) ?? 0) / 100) * m.kpiMax * x(name);
  const kpiEarned = partnerNames.reduce((a, n) => a + kpiEarnedBy(n), 0);
  const kpiPaid = Math.min(kpiEarned, Math.max(0, afterReserve - basePaid));
  const kpiScale = kpiEarned > 0 ? kpiPaid / kpiEarned : 0;
  const profit = cashAfterCosts - reserveTopUp - basePaid - kpiPaid;
  const retained = (m.retainPct / 100) * Math.max(0, profit);
  const distributable = Math.max(0, profit) - retained;
  const share = (name: string) => (m.newShares.find((p) => p.name === name)?.pct ?? 0) / 100;

  const partners: PartnerPay[] = partnerNames.map((name) => {
    const base = x(name) * m.baseFraction * baseScale;
    const kPaid = kpiEarnedBy(name) * kpiScale;
    const distribution = distributable * share(name);
    const due = base + kPaid + distribution;
    const legacyBefore = legacy.find((l) => l.partner === name)?.balance ?? 0;
    const withheld = m.withholdLegacy && legacyBefore < 0 ? Math.min(due, -legacyBefore) : 0;
    return { name, x: x(name), base, kpiScore: score(name), kpiEarned: kpiEarnedBy(name), kpiPaid: kPaid, distribution, due, withheld, paid: due - withheld, legacyBefore };
  });
  return {
    month,
    ...win,
    income: flow.income,
    costs: flow.costs,
    cashAfterCosts,
    cashAtStart: cashStart,
    reserveTarget: target,
    reserveTopUp,
    tier,
    tierIncome,
    pool,
    basePaid,
    kpiEarned,
    kpiPaid,
    profit,
    retained,
    distributable,
    partners,
    missingScores: tier ? partnerNames.filter((n) => score(n) === null) : [],
    approved: approved ?? null,
  };
}

// ---------------- the monthly partner review ----------------

export async function saveReview(db: Db, month: string, scores: { partner: string; kpiScore: number; notes?: string | null }[], userId: number | null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false as const, error: "Pick a month" };
  const [run] = await db.select({ id: payRuns.id }).from(payRuns).where(eq(payRuns.month, month));
  if (run) return { ok: false as const, error: "This month's pay is approved: undo the approval to change the scores" };
  const s = await getSettings(db);
  const names = s.financeModel.newShares.map((p) => p.name);
  for (const sc of scores) {
    if (!names.includes(sc.partner)) return { ok: false as const, error: "Unknown partner" };
    if (!Number.isInteger(sc.kpiScore) || sc.kpiScore < 0 || sc.kpiScore > 100) return { ok: false as const, error: "Scores are whole numbers from 0 to 100" };
  }
  for (const sc of scores) {
    const values = { month, partner: sc.partner, kpiScore: sc.kpiScore, notes: sc.notes?.trim().slice(0, 1000) || null, updatedBy: userId, updatedAt: new Date() };
    await db.insert(partnerReviews).values(values).onConflictDoUpdate({ target: [partnerReviews.month, partnerReviews.partner], set: values });
  }
  await audit(db, { userId, entity: "partner_review", action: "save", diff: { month, partners: scores.length } });
  return { ok: true as const };
}

export async function reviewsFor(db: Db, month: string) {
  return db.select().from(partnerReviews).where(eq(partnerReviews.month, month));
}

/**
 * Approves a month's pay: keeps the waterfall as it stands, books each partner's base pay, KPI pay and
 * distribution as Owed (finance marks them Paid when the money moves; nothing is paid automatically), and moves
 * withheld pay into the legacy ledger.
 */
export async function approvePay(db: Db, month: string, userId: number | null, now = new Date()) {
  const w = await waterfall(db, month);
  if (w.approved) return { ok: false as const, error: "This month is already approved" };
  if (!w.inNewCycle) return { ok: false as const, error: "This month is before the new cycle" };
  if (month >= cairoYmd(now).slice(0, 7)) return { ok: false as const, error: "Approve a month once it is over" };
  if (w.missingScores.length) return { ok: false as const, error: `Score ${w.missingScores.join(", ")} in the partner review first` };
  const [, end] = monthRange(month);
  const date = new Date(end.getTime() - 12 * 3_600_000); // the month's last day
  return db.transaction(async (tx) => {
    const [run] = await tx.insert(payRuns).values({ month, snapshot: w, approvedBy: userId }).returning({ id: payRuns.id });
    for (const p of w.partners) {
      // what is actually paid, after withholding: take the withholding from the distribution first, then KPI, then base
      let hold = p.withheld;
      const parts: [string, number][] = [];
      for (const [label, amount] of [["Profit distribution", p.distribution], ["Partner KPI pay", p.kpiPaid], ["Partner base pay", p.base]] as const) {
        const take = Math.min(hold, amount);
        hold -= take;
        parts.push([label, amount - take]);
      }
      for (const [category, amount] of parts) {
        const egp = r0(amount);
        if (egp <= 0) continue;
        await tx.insert(ledgerEntries).values({
          entry: `${category}, ${month}: ${p.name}`,
          amountEgp: egp,
          date,
          section: "partner_withdrawals",
          category,
          status: "owed",
          partner: p.name,
          reference: `payrun:${run.id}`,
          createdBy: userId,
        });
      }
      if (r0(p.withheld) > 0)
        await tx.insert(legacyMovements).values({ partner: p.name, kind: "withholding", amountEgp: r0(p.withheld), month, note: `Withheld from ${month} pay`, createdBy: userId });
    }
    await audit(tx, { userId, entity: "pay_run", entityId: run.id, action: "approve", diff: { month, tier: w.tier } });
    return { ok: true as const, id: run.id };
  });
}

/** Undoes an approval while none of its pay has been marked Paid. */
export async function undoPay(db: Db, month: string, userId: number | null) {
  const [run] = await db.select().from(payRuns).where(eq(payRuns.month, month));
  if (!run) return { ok: false as const, error: "This month is not approved" };
  const rows = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.reference, `payrun:${run.id}`), isNull(ledgerEntries.deletedAt)));
  if (rows.some((r) => r.status === "paid")) return { ok: false as const, error: "Some of this pay is already marked Paid: change those rows in the ledger first" };
  return db.transaction(async (tx) => {
    await tx.update(ledgerEntries).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(ledgerEntries.reference, `payrun:${run.id}`));
    await tx.delete(legacyMovements).where(and(eq(legacyMovements.kind, "withholding"), eq(legacyMovements.month, month)));
    await tx.delete(payRuns).where(eq(payRuns.id, run.id));
    await audit(tx, { userId, entity: "pay_run", entityId: run.id, action: "undo", diff: { month } });
    return { ok: true as const };
  });
}
