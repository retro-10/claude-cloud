import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads, ledgerEntries, teamMembers } from "@/db/schema";
import { getSettings, type Settings } from "./app-settings";
import { audit } from "./audit";
import { cairoLocalToDate, cairoYmd } from "./time";

/**
 * The money side of Camp, following the rules on the Notion "Finances" page:
 *  1. Net income = money RECEIVED (candidate payments + OrlaDent client work) − refunds. No costs first.
 *  2. Net income is split between the partners and Capital (default Badr 30 · Sayyed 20 · Retro 15 · Mo 15 ·
 *     Capital 20; editable in Settings).
 *  3. All business costs (fixed and variable) are PAID out of Capital; capital can go negative.
 *  4. Partner withdrawals are advances on that partner's share; overdrawing comes off later shares.
 *  5. Expected / Owed rows are money that has not moved yet: they never count until Received / Paid.
 * Amounts are whole EGP; a row's month is its Date (or the day it was recorded), in Cairo time.
 */
export type Section = (typeof ledgerEntries.$inferSelect)["section"];
export type Status = (typeof ledgerEntries.$inferSelect)["status"];
export type Entry = typeof ledgerEntries.$inferSelect;

export const SECTIONS: Record<Section, { label: string; statuses: Status[]; categories: string[] }> = {
  income: { label: "Income", statuses: ["received", "expected", "cancelled"], categories: ["Candidate payment", "OrlaDent client work", "Refund"] },
  fixed_costs: { label: "Fixed costs", statuses: ["paid", "owed", "cancelled"], categories: ["Salaries", "Subscriptions"] },
  variable_costs: {
    label: "Variable costs",
    statuses: ["paid", "owed", "cancelled"],
    categories: ["Freelancers & sales", "Video production", "Content creator", "Equipment"],
  },
  partner_withdrawals: { label: "Partner withdrawals", statuses: ["paid", "owed", "cancelled"], categories: ["Partner withdrawal"] },
};
export const STATUS_LABEL: Record<Status, string> = { received: "Received", expected: "Expected", paid: "Paid", owed: "Owed", cancelled: "Cancelled" };
export const PAYMENT_PLAN_LABEL = { one_time: "One-time", installments: "Installments", free_seat: "Free seat" } as const;
export const STUDENT_STATUS_LABEL = { active: "Active", graduated: "Graduated", dropped: "Dropped" } as const;

export type Split = Settings["financeSplit"];

// ---------------- writing ----------------

export type EntryInput = {
  entry: string;
  amountEgp: number;
  date?: Date | null;
  dateApproximate?: boolean;
  section: Section;
  category: string;
  status: Status;
  partner?: string | null;
  fromTo?: string | null;
  reference?: string | null;
  notes?: string | null;
  enrolmentId?: number | null;
  cohortId?: number | null;
  teamMemberId?: number | null;
};
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

export function entryProblem(e: EntryInput, split: Split): string | null {
  if (!e.entry.trim() || e.entry.length > 200) return "Give the entry a short name";
  if (!Number.isInteger(e.amountEgp) || e.amountEgp <= 0) return "Amount must be a whole number of EGP above zero";
  const sec = SECTIONS[e.section];
  if (!sec) return "Choose a section";
  if (!sec.statuses.includes(e.status)) return `${sec.label} can be ${sec.statuses.map((s) => STATUS_LABEL[s]).join(", ")}`;
  if (!e.category.trim() || e.category.length > 80) return "Choose a category";
  if (e.section === "partner_withdrawals" && !split.partners.some((p) => p.name === e.partner)) return "Choose which partner withdrew";
  if (e.enrolmentId && e.section !== "income") return "Only income can be linked to a candidate";
  return null;
}

export async function saveEntry(db: Db, id: number | null, e: EntryInput, userId: number | null): Promise<Result<{ id: number }>> {
  const { financeSplit } = await getSettings(db);
  const bad = entryProblem(e, financeSplit);
  if (bad) return { ok: false, error: bad };
  let cohortId = e.cohortId ?? null;
  if (e.enrolmentId) {
    const [en] = await db.select({ cohortId: enrolments.cohortId }).from(enrolments).where(eq(enrolments.id, e.enrolmentId));
    if (!en) return { ok: false, error: "Candidate not found" };
    cohortId = en.cohortId;
  }
  const values = {
    entry: e.entry.trim(),
    amountEgp: e.amountEgp,
    date: e.date ?? null,
    dateApproximate: e.dateApproximate ?? false,
    section: e.section,
    category: e.category.trim(),
    status: e.status,
    partner: e.section === "partner_withdrawals" ? (e.partner ?? null) : null,
    fromTo: clean(e.fromTo),
    reference: clean(e.reference),
    notes: clean(e.notes),
    enrolmentId: e.enrolmentId ?? null,
    cohortId,
    teamMemberId: e.section === "income" ? null : (e.teamMemberId ?? null),
    updatedAt: new Date(),
  };
  return db.transaction(async (tx) => {
    let rowId = id;
    if (id) {
      const r = await tx.update(ledgerEntries).set(values).where(and(eq(ledgerEntries.id, id), isNull(ledgerEntries.deletedAt))).returning({ id: ledgerEntries.id });
      if (!r.length) return { ok: false as const, error: "Entry not found" };
    } else {
      const [r] = await tx.insert(ledgerEntries).values({ ...values, createdBy: userId }).returning({ id: ledgerEntries.id });
      rowId = r.id;
    }
    // amounts only in the diff: no names or references in the audit log
    await audit(tx, { userId, entity: "ledger", entityId: rowId!, action: id ? "update" : "create", diff: { section: e.section, status: e.status, amountEgp: e.amountEgp } });
    return { ok: true as const, id: rowId! };
  });
}

export async function deleteEntry(db: Db, id: number, userId: number | null) {
  await db.update(ledgerEntries).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(ledgerEntries.id, id));
  await audit(db, { userId, entity: "ledger", entityId: id, action: "delete" });
}

/** Marks an Expected / Owed row as having moved (Received / Paid), dated today unless it already has a date in the past. */
export async function settleEntry(db: Db, id: number, userId: number | null) {
  const [e] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id));
  if (!e || e.deletedAt) return { ok: false as const, error: "Entry not found" };
  const status: Status = e.section === "income" ? "received" : "paid";
  const date = e.date && e.date <= new Date() ? e.date : new Date();
  await db.update(ledgerEntries).set({ status, date, updatedAt: new Date() }).where(eq(ledgerEntries.id, id));
  await audit(db, { userId, entity: "ledger", entityId: id, action: "settle", diff: { status } });
  return { ok: true as const };
}

/** A candidate payment: income · Candidate payment, linked to the enrolment (and so to its batch). */
export async function recordPayment(
  db: Db,
  input: { enrolmentId: number; amountEgp: number; date?: Date | null; status?: "received" | "expected"; reference?: string | null; entry?: string; notes?: string | null },
  userId: number | null,
) {
  const [row] = await db
    .select({ name: leads.fullName })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .where(eq(enrolments.id, input.enrolmentId));
  if (!row) return { ok: false as const, error: "Candidate not found" };
  const status = input.status ?? "received";
  return saveEntry(
    db,
    null,
    {
      entry: input.entry ?? `${row.name} — ${status === "expected" ? "installment due" : "payment"}`,
      amountEgp: input.amountEgp,
      date: input.date ?? null,
      section: "income",
      category: "Candidate payment",
      status,
      reference: input.reference,
      notes: input.notes,
      enrolmentId: input.enrolmentId,
    },
    userId,
  );
}

// ---------------- reading: candidates ----------------

/**
 * What a candidate owes (for the enrolments row or alias `e`): free seat = 0, otherwise the agreed price minus the
 * discount. A dropped student owes no more than they kept paid (net of refunds): their balance stops and revenue
 * counts only the money they left with us.
 */
export function dueFor(e: string): SQL<number> {
  const price = `greatest(${e}.amount_egp - ${e}.discount_egp, 0)`;
  const paid = `coalesce((select sum(case when x.category = 'Refund' then -x.amount_egp else x.amount_egp end) from ledger_entries x
    where x.enrolment_id = ${e}.id and x.deleted_at is null and x.section = 'income' and x.status = 'received'), 0)`;
  return sql.raw(`(case when ${e}.payment_plan = 'free_seat' then 0 when ${e}.status = 'dropped' then least(${price}, greatest(${paid}, 0)) else ${price} end)`) as SQL<number>;
}
export const dueSql = dueFor(`"enrolments"`);
const paidSql = sql<number>`coalesce((select sum(case when x.category = 'Refund' then -x.amount_egp else x.amount_egp end) from ledger_entries x
  where x.enrolment_id = ${enrolments.id} and x.deleted_at is null and x.section = 'income' and x.status = 'received'), 0)::int`;
// a dropped student is expected to pay nothing more
const expectedSql = sql<number>`(case when ${enrolments.status} = 'dropped' then 0 else coalesce((select sum(x.amount_egp) from ledger_entries x
  where x.enrolment_id = ${enrolments.id} and x.deleted_at is null and x.section = 'income' and x.status = 'expected'), 0) end)::int`;
// an Expected payment without a date is still owed but has no due date (it never shows as overdue)
const nextDueSql = sql<string | null>`(case when ${enrolments.status} = 'dropped' then null else (select min(x.date) from ledger_entries x
  where x.enrolment_id = ${enrolments.id} and x.deleted_at is null and x.section = 'income' and x.status = 'expected') end)`;

export type CandidateRow = {
  enrolmentId: number;
  leadId: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  cohortId: number;
  cohort: string;
  tier: string;
  paymentPlan: keyof typeof PAYMENT_PLAN_LABEL;
  status: keyof typeof STUDENT_STATUS_LABEL;
  amountEgp: number;
  discountEgp: number;
  due: number;
  paid: number;
  expected: number;
  remaining: number;
  nextDue: Date | null;
  firstInstalmentAt: Date | null;
  finalInstalmentAt: Date | null;
  contentConsent: boolean;
  contentConsentScope: string[];
  qcScore: number | null;
  leaderboardRank: number | null;
};

export async function listCandidates(db: Db, opts: { cohortId?: number; enrolmentId?: number; leadId?: number } = {}): Promise<CandidateRow[]> {
  const where: (SQL | undefined)[] = [];
  if (opts.cohortId) where.push(eq(enrolments.cohortId, opts.cohortId));
  if (opts.enrolmentId) where.push(eq(enrolments.id, opts.enrolmentId));
  if (opts.leadId) where.push(eq(enrolments.leadId, opts.leadId));
  const rows = await db
    .select({
      enrolmentId: enrolments.id,
      leadId: leads.id,
      fullName: leads.fullName,
      phone: leads.phoneWhatsapp,
      email: leads.email,
      cohortId: cohorts.id,
      cohort: cohorts.name,
      tier: enrolments.tier,
      paymentPlan: enrolments.paymentPlan,
      status: enrolments.status,
      amountEgp: enrolments.amountEgp,
      discountEgp: enrolments.discountEgp,
      due: dueSql,
      paid: paidSql,
      expected: expectedSql,
      nextDue: nextDueSql,
      firstInstalmentAt: enrolments.firstInstalmentAt,
      finalInstalmentAt: enrolments.finalInstalmentAt,
      contentConsent: enrolments.contentConsent,
      contentConsentScope: enrolments.contentConsentScope,
      qcScore: enrolments.qcScore,
      leaderboardRank: enrolments.leaderboardRank,
    })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .innerJoin(cohorts, eq(cohorts.id, enrolments.cohortId))
    .where(and(...where))
    .orderBy(desc(cohorts.id), asc(leads.fullName));
  return rows.map((r) => ({
    ...r,
    due: Number(r.due),
    paid: Number(r.paid),
    expected: Number(r.expected),
    remaining: Math.max(0, Number(r.due) - Number(r.paid)),
    nextDue: r.nextDue ? new Date(r.nextDue) : null,
  }));
}

// ---------------- reading: the books ----------------

export const effectiveDate = sql`coalesce(${ledgerEntries.date}, ${ledgerEntries.createdAt})`;
const cairoMonth = sql<string>`to_char(${effectiveDate} at time zone 'Africa/Cairo', 'YYYY-MM')`;

/** "2026-09" -> [start, end) instants in Cairo time. */
export function monthRange(ym: string): [Date, Date] {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return [cairoLocalToDate(`${ym}-01`)!, cairoLocalToDate(`${next}-01`)!];
}
export const thisMonth = (now = new Date()) => cairoYmd(now).slice(0, 7);
export function shiftMonth(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export type Totals = {
  income: number; // received, before refunds
  refunds: number;
  net: number; // income - refunds: what is split
  costs: number; // fixed + variable, paid
  fixedCosts: number;
  variableCosts: number;
  capitalShare: number;
  capitalLeft: number; // capital share - costs
  shares: { name: string; pct: number; share: number; withdrawn: number }[];
  byCategory: { section: Section; category: string; amount: number }[];
};

type Agg = { section: Section; category: string; status: Status; partner: string | null; amount: number };

function totalsFrom(rows: Agg[], split: Split): Totals {
  const sum = (f: (r: Agg) => boolean) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
  const income = sum((r) => r.section === "income" && r.status === "received" && r.category !== "Refund");
  const refunds = sum((r) => r.section === "income" && r.category === "Refund" && r.status === "received");
  const net = income - refunds;
  const fixedCosts = sum((r) => r.section === "fixed_costs" && r.status === "paid");
  const variableCosts = sum((r) => r.section === "variable_costs" && r.status === "paid");
  const costs = fixedCosts + variableCosts;
  const capitalShare = (net * split.capitalPct) / 100;
  const byCat = new Map<string, { section: Section; category: string; amount: number }>();
  for (const r of rows.filter((r) => r.status === "received" || r.status === "paid")) {
    const k = `${r.section}|${r.category}`;
    const cur = byCat.get(k) ?? { section: r.section, category: r.category, amount: 0 };
    cur.amount += r.amount;
    byCat.set(k, cur);
  }
  return {
    income,
    refunds,
    net,
    costs,
    fixedCosts,
    variableCosts,
    capitalShare,
    capitalLeft: capitalShare - costs,
    shares: split.partners.map((p) => ({
      name: p.name,
      pct: p.pct,
      share: (net * p.pct) / 100,
      withdrawn: sum((r) => r.section === "partner_withdrawals" && r.status === "paid" && r.partner === p.name),
    })),
    byCategory: [...byCat.values()].sort((a, b) => b.amount - a.amount),
  };
}

async function aggregate(db: Db, where: SQL | undefined): Promise<Agg[]> {
  const rows = await db
    .select({
      section: ledgerEntries.section,
      category: ledgerEntries.category,
      status: ledgerEntries.status,
      partner: ledgerEntries.partner,
      amount: sql<number>`sum(${ledgerEntries.amountEgp})::int`,
    })
    .from(ledgerEntries)
    .where(and(isNull(ledgerEntries.deletedAt), where))
    .groupBy(ledgerEntries.section, ledgerEntries.category, ledgerEntries.status, ledgerEntries.partner);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export type Board = {
  month: string;
  split: Split;
  month_: Totals; // the selected month
  allTime: Totals;
  // what each partner can still take: all-time share minus all-time withdrawals, as of the end of the month
  balances: { name: string; share: number; withdrawn: number; balance: number }[];
  capitalBalance: number;
  comingUp: (Entry & { candidate: string | null })[];
  series: { month: string; income: number; costs: number; net: number }[];
  candidates: { count: number; due: number; paid: number; expected: number; remaining: number };
};

export async function financeBoard(db: Db, month = thisMonth()): Promise<Board> {
  const s = await getSettings(db);
  const [start, end] = monthRange(month);
  const inMonth = sql`${effectiveDate} >= ${start.toISOString()}::timestamptz and ${effectiveDate} < ${end.toISOString()}::timestamptz`;
  const upToEnd = sql`${effectiveDate} < ${end.toISOString()}::timestamptz`;
  const firstMonth = shiftMonth(month, -11);
  const [seriesStart] = monthRange(firstMonth);

  const [monthRows, allRows, upToRows, coming, seriesRows, cand] = await Promise.all([
    aggregate(db, inMonth),
    aggregate(db, undefined),
    aggregate(db, upToEnd),
    db
      .select({ e: ledgerEntries, candidate: leads.fullName })
      .from(ledgerEntries)
      .leftJoin(enrolments, eq(enrolments.id, ledgerEntries.enrolmentId))
      .leftJoin(leads, eq(leads.id, enrolments.leadId))
      .where(and(isNull(ledgerEntries.deletedAt), sql`${ledgerEntries.status} in ('expected', 'owed')`, sql`${enrolments.status} is distinct from 'dropped'`))
      .orderBy(sql`${effectiveDate} asc`)
      .limit(100),
    db
      .select({
        month: cairoMonth,
        income: sql<number>`coalesce(sum(case when ${ledgerEntries.section} = 'income' and ${ledgerEntries.status} = 'received'
          then (case when ${ledgerEntries.category} = 'Refund' then -${ledgerEntries.amountEgp} else ${ledgerEntries.amountEgp} end) end), 0)::int`,
        costs: sql<number>`coalesce(sum(case when ${ledgerEntries.section} in ('fixed_costs', 'variable_costs') and ${ledgerEntries.status} = 'paid'
          then ${ledgerEntries.amountEgp} end), 0)::int`,
      })
      .from(ledgerEntries)
      .where(and(isNull(ledgerEntries.deletedAt), sql`${effectiveDate} >= ${seriesStart.toISOString()}::timestamptz and ${upToEnd}`))
      .groupBy(cairoMonth),
    listCandidates(db),
  ]);

  const upTo = totalsFrom(upToRows, s.financeSplit);
  const byMonth = new Map(seriesRows.map((r) => [r.month, r]));
  const series = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(firstMonth, i);
    const r = byMonth.get(m);
    const income = Number(r?.income ?? 0);
    const costs = Number(r?.costs ?? 0);
    return { month: m, income, costs, net: income - costs };
  });
  return {
    month,
    split: s.financeSplit,
    month_: totalsFrom(monthRows, s.financeSplit),
    allTime: totalsFrom(allRows, s.financeSplit),
    balances: upTo.shares.map((p) => ({ name: p.name, share: p.share, withdrawn: p.withdrawn, balance: p.share - p.withdrawn })),
    capitalBalance: upTo.capitalLeft,
    comingUp: coming.map((c) => ({ ...c.e, candidate: c.candidate })),
    series,
    candidates: {
      count: cand.length,
      due: cand.reduce((a, c) => a + c.due, 0),
      paid: cand.reduce((a, c) => a + c.paid, 0),
      expected: cand.reduce((a, c) => a + c.expected, 0),
      remaining: cand.reduce((a, c) => a + c.remaining, 0),
    },
  };
}

export async function listEntries(
  db: Db,
  f: { month?: string; section?: Section; status?: Status; q?: string; enrolmentId?: number } = {},
  limit = 200,
) {
  const where: (SQL | undefined)[] = [isNull(ledgerEntries.deletedAt)];
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const [a, b] = monthRange(f.month);
    where.push(sql`${effectiveDate} >= ${a.toISOString()}::timestamptz and ${effectiveDate} < ${b.toISOString()}::timestamptz`);
  }
  if (f.section && f.section in SECTIONS) where.push(eq(ledgerEntries.section, f.section));
  if (f.status) where.push(eq(ledgerEntries.status, f.status));
  if (f.enrolmentId) where.push(eq(ledgerEntries.enrolmentId, f.enrolmentId));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    where.push(sql`(${ledgerEntries.entry} ilike ${like} or coalesce(${ledgerEntries.fromTo}, '') ilike ${like} or coalesce(${ledgerEntries.notes}, '') ilike ${like})`);
  }
  return db
    .select({ e: ledgerEntries, candidate: leads.fullName, leadId: leads.id, cohort: cohorts.name, teamMember: teamMembers.name })
    .from(ledgerEntries)
    .leftJoin(enrolments, eq(enrolments.id, ledgerEntries.enrolmentId))
    .leftJoin(leads, eq(leads.id, enrolments.leadId))
    .leftJoin(cohorts, eq(cohorts.id, ledgerEntries.cohortId))
    .leftJoin(teamMembers, eq(teamMembers.id, ledgerEntries.teamMemberId))
    .where(and(...where))
    .orderBy(sql`${effectiveDate} desc`, desc(ledgerEntries.id))
    .limit(limit);
}

// ---------------- candidates: plan and status ----------------

export async function updateCandidate(
  db: Db,
  enrolmentId: number,
  p: {
    tier?: (typeof enrolments.$inferInsert)["tier"];
    amountEgp?: number;
    discountEgp?: number;
    paymentPlan?: keyof typeof PAYMENT_PLAN_LABEL;
    firstInstalmentAt?: Date | null;
    finalInstalmentAt?: Date | null;
    status?: keyof typeof STUDENT_STATUS_LABEL;
    notes?: string | null;
  },
  userId: number | null,
): Promise<Result> {
  if (p.amountEgp !== undefined && (!Number.isInteger(p.amountEgp) || p.amountEgp < 0)) return { ok: false, error: "Price must be a whole number of EGP" };
  if (p.discountEgp !== undefined && (!Number.isInteger(p.discountEgp) || p.discountEgp < 0)) return { ok: false, error: "Discount must be a whole number of EGP" };
  const set: Partial<typeof enrolments.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["tier", "amountEgp", "discountEgp", "paymentPlan", "firstInstalmentAt", "finalInstalmentAt", "status"] as const) {
    if (p[k] !== undefined) (set as Record<string, unknown>)[k] = p[k];
  }
  if (p.notes !== undefined) set.notes = clean(p.notes);
  return db.transaction(async (tx) => {
    const rows = await tx.update(enrolments).set(set).where(eq(enrolments.id, enrolmentId)).returning({ id: enrolments.id });
    if (!rows.length) return { ok: false, error: "Candidate not found" } as const;
    // a dropped student pays nothing more: their open instalments are cancelled (money already received stays)
    const cancelled =
      p.status === "dropped"
        ? await tx
            .update(ledgerEntries)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(and(eq(ledgerEntries.enrolmentId, enrolmentId), isNull(ledgerEntries.deletedAt), eq(ledgerEntries.section, "income"), eq(ledgerEntries.status, "expected")))
            .returning({ id: ledgerEntries.id })
        : [];
    await audit(tx, {
      userId,
      entity: "enrolment",
      entityId: enrolmentId,
      action: "update",
      diff: { fields: Object.keys(set).filter((k) => k !== "updatedAt"), ...(cancelled.length ? { cancelledInstalments: cancelled.length } : {}) },
    });
    return { ok: true } as const;
  });
}
