// The partners' money rules (the rebuild plan's cycle close, new shares, reserve and pay tiers) as settings an
// owner edits, or imports from the Cycle Close workbook. Nothing here is computed: see cycle.ts for the arithmetic.

export type Share = { name: string; pct: number };

export type FixedCost = { label: string; amount: number; low: number | null; high: number | null; note: string };

export type PartnerProfile = {
  name: string; // the same name as in the split and on withdrawals
  role: string;
  outcome: string; // the outcome numbers the KPI score is judged on
  multiplier: number; // on the accountable load (for example more weight for a heavier function)
  balancing: boolean; // takes the rounding difference so the salaries add up to the pool exactly
};

export type FinanceModel = {
  closeDate: string | null; // YYYY-MM-DD: money up to the end of this day belongs to the old cycle; null = no close planned
  coreSplit: { partners: Share[]; capitalPct: number }; // old split of design house (Core) income; Camp uses the main split
  newShares: Share[]; // equal 25% shares from the close
  retainPct: number; // of profit after pay, kept in the company
  reserveMonths: number; // cash reserve target, in months of fixed costs
  fixedCosts: FixedCost[]; // the monthly working figure, built up line by line
  tiers: { pool: number }[]; // partner salary pool per month, Tier 1 upwards
  triggerBuffer: number; // trigger = (fixed costs + pool) x buffer
  triggerRound: number; // ... rounded to the nearest of this
  monthsRunning: number; // collected income must clear the trigger this many months running
  baseFraction: number; // base pay = X x this (X/2)
  kpiMax: number; // KPI pay up to X x this (2X)
  partners: PartnerProfile[];
  seatPrice: number; // full-price seat, for the break-even in seats
  exocadFeePerCase: number; // variable cost per case file, not in the seat counts
  agentCommissionPct: number; // sales agents' commission
  withholdLegacy: boolean; // pay due to a partner who owes the legacy ledger is withheld toward it
};

// Neutral until the owners set their own rules (Settings > Finance & pay rules) or import their Cycle Close
// workbook: no close date, the old split for both companies, equal new shares, no fixed costs and no pay tiers.
// The partners' real figures live in the database only (this repository is public).
const PARTNERS = ["Badr", "Sayyed", "Retro", "Mo"];

export const DEFAULT_FINANCE_MODEL: FinanceModel = {
  closeDate: null,
  coreSplit: {
    partners: [
      { name: "Badr", pct: 30 },
      { name: "Sayyed", pct: 20 },
      { name: "Retro", pct: 15 },
      { name: "Mo", pct: 15 },
    ],
    capitalPct: 20,
  },
  newShares: PARTNERS.map((name) => ({ name, pct: 100 / PARTNERS.length })),
  retainPct: 0,
  reserveMonths: 0,
  fixedCosts: [],
  tiers: [],
  triggerBuffer: 1.25,
  triggerRound: 5000,
  monthsRunning: 2,
  baseFraction: 0.5,
  kpiMax: 2,
  partners: PARTNERS.map((name, i) => ({ name, role: "", outcome: "", multiplier: 1, balancing: i === PARTNERS.length - 1 })),
  seatPrice: 9000,
  exocadFeePerCase: 0,
  agentCommissionPct: 0,
  withholdLegacy: true,
};

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function shares(list: unknown, max = 10): Share[] | undefined {
  if (!Array.isArray(list) || !list.length || list.length > max) return undefined;
  const out: Share[] = [];
  for (const p of list) {
    if (!p || !str(p.name, 40) || !p.name.trim() || !num(p.pct, 0, 100)) return undefined;
    out.push({ name: p.name.trim(), pct: p.pct });
  }
  return new Set(out.map((p) => p.name)).size === out.length ? out : undefined;
}

/** Checks a whole model; undefined when anything is out of range or the shares do not add up to 100%. */
export function validateFinanceModel(v: unknown): FinanceModel | undefined {
  const m = v as FinanceModel;
  if (!m || typeof m !== "object") return undefined;
  if (!(m.closeDate === null || (typeof m.closeDate === "string" && YMD.test(m.closeDate)))) return undefined;
  const core = shares(m.coreSplit?.partners);
  if (!core || !num(m.coreSplit.capitalPct, 0, 100)) return undefined;
  if (Math.abs(core.reduce((a, p) => a + p.pct, 0) + m.coreSplit.capitalPct - 100) > 0.001) return undefined;
  const next = shares(m.newShares);
  if (!next || Math.abs(next.reduce((a, p) => a + p.pct, 0) - 100) > 0.001) return undefined;
  if (!num(m.retainPct, 0, 100) || !num(m.reserveMonths, 0, 24)) return undefined;
  if (!Array.isArray(m.fixedCosts) || m.fixedCosts.length > 40) return undefined;
  const fixedCosts: FixedCost[] = [];
  for (const f of m.fixedCosts) {
    if (!f || !str(f.label, 80) || !f.label.trim() || !num(f.amount, 0, 10_000_000)) return undefined;
    if (!(f.low == null || num(f.low, 0, 10_000_000)) || !(f.high == null || num(f.high, 0, 10_000_000))) return undefined;
    fixedCosts.push({ label: f.label.trim(), amount: Math.round(f.amount), low: f.low ?? null, high: f.high ?? null, note: str(f.note, 200) ? (f.note ?? "").trim() : "" });
  }
  if (!Array.isArray(m.tiers) || m.tiers.length > 6 || !m.tiers.every((t) => num(t?.pool, 1, 10_000_000))) return undefined;
  if (m.tiers.some((t, i) => i > 0 && t.pool <= m.tiers[i - 1].pool)) return undefined; // each tier above the last
  if (!num(m.triggerBuffer, 1, 5) || !num(m.triggerRound, 1, 1_000_000) || !Number.isInteger(m.monthsRunning) || !num(m.monthsRunning, 1, 12)) return undefined;
  if (!num(m.baseFraction, 0, 1) || !num(m.kpiMax, 0, 10)) return undefined;
  if (!Array.isArray(m.partners) || !m.partners.length || m.partners.length > 10) return undefined;
  const partners: PartnerProfile[] = [];
  for (const p of m.partners) {
    if (!p || !str(p.name, 40) || !p.name.trim() || !str(p.role, 120) || !str(p.outcome, 500) || !num(p.multiplier, 0, 10) || typeof p.balancing !== "boolean") return undefined;
    partners.push({ name: p.name.trim(), role: p.role.trim(), outcome: p.outcome.trim(), multiplier: p.multiplier, balancing: p.balancing });
  }
  if (new Set(partners.map((p) => p.name)).size !== partners.length || partners.filter((p) => p.balancing).length > 1) return undefined;
  if (!num(m.seatPrice, 1, 10_000_000) || !num(m.exocadFeePerCase, 0, 1_000_000) || !num(m.agentCommissionPct, 0, 100) || typeof m.withholdLegacy !== "boolean") return undefined;
  return {
    closeDate: m.closeDate,
    coreSplit: { partners: core, capitalPct: m.coreSplit.capitalPct },
    newShares: next,
    retainPct: m.retainPct,
    reserveMonths: m.reserveMonths,
    fixedCosts,
    tiers: m.tiers.map((t) => ({ pool: Math.round(t.pool) })),
    triggerBuffer: m.triggerBuffer,
    triggerRound: m.triggerRound,
    monthsRunning: m.monthsRunning,
    baseFraction: m.baseFraction,
    kpiMax: m.kpiMax,
    partners,
    seatPrice: m.seatPrice,
    exocadFeePerCase: m.exocadFeePerCase,
    agentCommissionPct: m.agentCommissionPct,
    withholdLegacy: m.withholdLegacy,
  };
}

// ---------------- prices and decision rights ----------------

export type TierPrice = { key: "foundation" | "freelance_ready" | "production_partner"; label: string; price: number; offered: boolean; payments: number };

/** Camp prices on sale (public prices): Freelance Ready 9,000 EGP in two payments; Foundation no longer sold. */
export const DEFAULT_PRICES: TierPrice[] = [
  { key: "foundation", label: "Foundation", price: 7500, offered: false, payments: 1 },
  { key: "freelance_ready", label: "Freelance Ready", price: 9000, offered: true, payments: 2 },
  { key: "production_partner", label: "Production Partner", price: 30000, offered: true, payments: 1 },
];

export function validatePrices(v: unknown): TierPrice[] | undefined {
  if (!Array.isArray(v) || v.length !== DEFAULT_PRICES.length) return undefined;
  const out: TierPrice[] = [];
  for (const d of DEFAULT_PRICES) {
    const p = v.find((x) => x?.key === d.key);
    if (!p || !str(p.label, 40) || !p.label.trim() || !num(p.price, 0, 10_000_000) || typeof p.offered !== "boolean" || !Number.isInteger(p.payments) || !num(p.payments, 1, 24)) return undefined;
    out.push({ key: d.key, label: p.label.trim(), price: Math.round(p.price), offered: p.offered, payments: p.payments });
  }
  return out;
}

export type DecisionRight = { decision: string; who: string };

export const DEFAULT_DECISION_RIGHTS: DecisionRight[] = []; // the owners write their own (Settings)

export function validateDecisionRights(v: unknown): DecisionRight[] | undefined {
  if (!Array.isArray(v) || v.length > 40) return undefined;
  const out: DecisionRight[] = [];
  for (const d of v) {
    if (!d || !str(d.decision, 200) || !str(d.who, 300)) return undefined;
    if (d.decision.trim() && d.who.trim()) out.push({ decision: d.decision.trim(), who: d.who.trim() });
  }
  return out;
}
