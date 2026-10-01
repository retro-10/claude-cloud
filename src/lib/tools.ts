// Pure calculations behind the Tools menu. No database, no server imports: the browser components use them
// directly, and the tests check them without a database.

export type Tier = "foundation" | "freelance_ready" | "production_partner";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD plus whole months; a day past the month's end lands on its last day (31 Jan + 1 = 28/29 Feb). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const prettyDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// ---------------- Offer builder ----------------

export type OfferInput = {
  tier: Tier;
  priceEgp: number; // agreed price before discount
  discountEgp: number;
  plan: "one_time" | "installments";
  depositEgp: number; // paid now (instalments only)
  instalments: number; // how many after the deposit, 1..6
  firstDue: string; // YYYY-MM-DD of the first instalment; then monthly
};

export type OfferResult =
  | { ok: true; total: number; schedule: { due: string | null; amount: number; label: string }[] }
  | { ok: false; error: string };

export function buildOffer(o: OfferInput): OfferResult {
  if (!Number.isInteger(o.priceEgp) || o.priceEgp <= 0) return { ok: false, error: "Enter the price in whole EGP" };
  if (!Number.isInteger(o.discountEgp) || o.discountEgp < 0 || o.discountEgp >= o.priceEgp) return { ok: false, error: "The discount must be less than the price" };
  const total = o.priceEgp - o.discountEgp;
  if (o.plan === "one_time") return { ok: true, total, schedule: [{ due: null, amount: total, label: "Full payment" }] };
  if (!Number.isInteger(o.instalments) || o.instalments < 1 || o.instalments > 6) return { ok: false, error: "Choose 1 to 6 instalments" };
  if (!Number.isInteger(o.depositEgp) || o.depositEgp < 0 || o.depositEgp >= total) return { ok: false, error: "The deposit must be less than the total" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.firstDue)) return { ok: false, error: "Pick the first instalment date" };
  const rest = total - o.depositEgp;
  // equal parts rounded down to 50 EGP; the last one takes the remainder so the sum is exact
  const part = Math.floor(rest / o.instalments / 50) * 50;
  const schedule: { due: string | null; amount: number; label: string }[] = [];
  if (o.depositEgp > 0) schedule.push({ due: null, amount: o.depositEgp, label: "Deposit now" });
  for (let i = 0; i < o.instalments; i++) {
    const amount = i === o.instalments - 1 ? rest - part * (o.instalments - 1) : part;
    schedule.push({ due: addMonthsYmd(o.firstDue, i), amount, label: `Instalment ${i + 1} of ${o.instalments}` });
  }
  return { ok: true, total, schedule };
}

/** A plain, factual WhatsApp message: programme, price, schedule, link. No incentives or claims (QUESTIONS.md 28). */
export function offerMessage(o: OfferInput, r: Extract<OfferResult, { ok: true }>, opts: { firstName?: string; tierLabel: string; paymentLink?: string; decisionBy?: string }) {
  const lines = [`Hi${opts.firstName ? ` ${opts.firstName}` : ""}, here is your OrlaDent Camp offer:`, `• Programme: ${opts.tierLabel}`];
  lines.push(o.discountEgp > 0 ? `• Price: ${fmt(r.total)} EGP (${fmt(o.priceEgp)} less ${fmt(o.discountEgp)} discount)` : `• Price: ${fmt(r.total)} EGP`);
  if (o.plan === "one_time") lines.push("• Payment: in full");
  else {
    const inst = r.schedule.filter((s) => s.due);
    const same = inst.every((s) => s.amount === inst[0].amount);
    const dates = inst.map((s) => prettyDate(s.due!)).join(", ");
    const deposit = o.depositEgp > 0 ? `${fmt(o.depositEgp)} EGP now, then ` : "";
    lines.push(
      same
        ? `• Payment: ${deposit}${inst.length} instalment${inst.length === 1 ? "" : "s"} of ${fmt(inst[0].amount)} EGP on ${dates}`
        : `• Payment: ${deposit}${inst.map((s) => `${fmt(s.amount)} EGP on ${prettyDate(s.due!)}`).join(", ")}`,
    );
  }
  if (opts.paymentLink) lines.push(`• Payment link: ${opts.paymentLink}`);
  if (opts.decisionBy) lines.push(`Could you let me know by ${prettyDate(opts.decisionBy)}?`);
  lines.push("Any questions, just reply here.");
  return lines.join("\n");
}

// ---------------- Batch planner ----------------

export type PlanInput = {
  seatsToFill: number;
  avgPriceEgp: number;
  leadToConsult: number; // 0..1: share of new leads that hold a consult
  consultToEnrol: number; // 0..1: share of held consults that enrol
  weeksLeft: number;
};

export type PlanResult =
  | { ok: true; consults: number; leads: number; leadsPerWeek: number; consultsPerWeek: number; revenueEgp: number }
  | { ok: false; error: string };

/** Works back from seats to consults to leads, at the given conversion rates. */
export function planBatch(p: PlanInput): PlanResult {
  if (!Number.isInteger(p.seatsToFill) || p.seatsToFill < 0) return { ok: false, error: "Seats to fill is a whole number" };
  if (!(p.leadToConsult > 0 && p.leadToConsult <= 1) || !(p.consultToEnrol > 0 && p.consultToEnrol <= 1)) return { ok: false, error: "Conversion rates are between 1% and 100%" };
  if (!(p.weeksLeft > 0)) return { ok: false, error: "The enrolment close date has passed: pick a later one" };
  const consults = Math.ceil(p.seatsToFill / p.consultToEnrol);
  const leads = Math.ceil(consults / p.leadToConsult);
  // under a week left, "a week" is all of it: never a weekly figure larger than the total
  const weeks = Math.max(1, p.weeksLeft);
  return {
    ok: true,
    consults,
    leads,
    consultsPerWeek: Math.ceil(consults / weeks),
    leadsPerWeek: Math.ceil(leads / weeks),
    revenueEgp: Math.round(p.seatsToFill * p.avgPriceEgp),
  };
}

// ---------------- Campaign ROI ----------------

export type RoiInput = {
  spendEgp: number;
  costPerLead: number;
  leadToConsult: number; // 0..1
  consultToEnrol: number; // 0..1
  avgPriceEgp: number;
};
export type RoiResult =
  | { ok: true; leads: number; consults: number; enrolments: number; revenueEgp: number; costPerEnrolment: number | null; roi: number; breakEvenCostPerLead: number }
  | { ok: false; error: string };

/** What a spend should bring at a cost per lead and your conversion rates, and the most a lead may cost to break even. */
export function campaignRoi(p: RoiInput): RoiResult {
  if (!(p.spendEgp > 0)) return { ok: false, error: "Enter the spend" };
  if (!(p.costPerLead > 0)) return { ok: false, error: "Enter the cost per lead" };
  if (!(p.leadToConsult > 0 && p.leadToConsult <= 1) || !(p.consultToEnrol > 0 && p.consultToEnrol <= 1)) return { ok: false, error: "Conversion rates are between 1% and 100%" };
  if (!(p.avgPriceEgp > 0)) return { ok: false, error: "Enter the average price" };
  const leads = Math.floor(p.spendEgp / p.costPerLead);
  const consultsExact = leads * p.leadToConsult;
  const enrolExact = consultsExact * p.consultToEnrol;
  const enrolments = Math.floor(enrolExact);
  const revenueEgp = Math.round(enrolments * p.avgPriceEgp);
  return {
    ok: true,
    leads,
    consults: Math.floor(consultsExact),
    enrolments,
    revenueEgp,
    costPerEnrolment: enrolments ? Math.round(p.spendEgp / enrolments) : null,
    roi: (revenueEgp - p.spendEgp) / p.spendEgp,
    // revenue per lead at these rates: spending more than this per lead loses money
    breakEvenCostPerLead: Math.floor(p.leadToConsult * p.consultToEnrol * p.avgPriceEgp),
  };
}
