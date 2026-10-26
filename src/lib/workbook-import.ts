import { createHash } from "node:crypto";
import { and, isNull, like, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { businessFunctions, ledgerEntries } from "@/db/schema";
import { getSettings, saveSettings } from "./app-settings";
import { audit } from "./audit";
import { effectiveDate, type Section, type Status, type Stream } from "./finance";
import type { FinanceModel, Share } from "./finance-model";
import { addDaysYmd, cairoLocalToDate } from "./time";
import { readXlsx, XlsxError, type Cell, type Sheet } from "./xlsx";

// Imports the partners' Cycle Close workbook (sheets Ledger, Assumptions, Function Owners, Salaries): the corrected
// payment list becomes the ledger, the assumptions become the finance model, the function table becomes the
// functions matrix. Always previewed first; the preview shows the workbook's own totals beside ours.

export type LedgerDraft = {
  row: number;
  entry: string;
  source: string;
  amountEgp: number;
  section: Section;
  category: string;
  status: Status;
  partner: string | null;
  stream: Stream;
};

export type FunctionDraft = { name: string; appliesTo: "both" | "core" | "camp"; weight: number; accountable: string | null; supporting: string[]; staff: string | null };

export type WorkbookPreview = {
  hash: string; // of the file: re-importing the same rows is skipped
  ledger: LedgerDraft[];
  skipped: { row: number; reason: string }[];
  totals: { campIncome: number; coreIncome: number; costs: number; withdrawals: number; cashToday: number; cashAtClose: number };
  workbookCash: { today: number | null; atClose: number | null }; // the workbook's own Cycle Position figures, to compare
  model: FinanceModel | null; // the assumptions, read into the finance model (null when the sheet is missing)
  campSplit: { partners: Share[]; capitalPct: number } | null; // the old Camp split (the main split setting)
  functions: FunctionDraft[];
};

const s = (c: Cell | undefined) => (c == null ? "" : String(c).trim());
const n = (c: Cell | undefined) => (typeof c === "number" ? c : Number.NaN);
const sheet = (all: Sheet[], name: string) => all.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());

/**
 * Which ledger section and category a workbook cost goes to. The workbook only says "Camp cost": salaries and
 * subscriptions are fixed, the rest variable. Every row can be changed afterwards in the ledger.
 */
export function costCategory(item: string): { section: Section; category: string } {
  const t = item.toLowerCase();
  if (/claude|google|meta|subscription|hosting|domain/.test(t)) return { section: "fixed_costs", category: "Subscriptions" };
  if (/salary|salaries|shahr|payroll/.test(t)) return { section: "fixed_costs", category: "Salaries" };
  if (/video|motion|edit|film/.test(t)) return { section: "variable_costs", category: "Video production" };
  if (/reel|content|story|stories/.test(t)) return { section: "variable_costs", category: "Content creator" };
  if (/equipment|microphone|camera|shooting|crochet|light/.test(t)) return { section: "variable_costs", category: "Equipment" };
  if (/\bad(s)?\b|campaign|boost|promotion/.test(t)) return { section: "variable_costs", category: "Ads & promotion" };
  return { section: "variable_costs", category: "Freelancers & sales" }; // commissions, Exocad setup, other people
}

function parseLedger(ws: Sheet, partners: string[]) {
  const ledger: LedgerDraft[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const headers = ws.rows.get(1);
  if (!headers || !/item/i.test(s(headers.get("B"))) || !/amount/i.test(s(headers.get("C")))) throw new XlsxError("The Ledger sheet does not have the expected columns (Source, Item, Amount, Direction, Category, Partner, Status)");
  for (const [r, cells] of [...ws.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (r === 1) continue;
    const source = s(cells.get("A"));
    const item = s(cells.get("B"));
    const amount = n(cells.get("C"));
    const direction = s(cells.get("D")).toLowerCase();
    const cat = s(cells.get("E")).toLowerCase();
    const partner = s(cells.get("F")) || null;
    const done = s(cells.get("G")).toLowerCase() !== "expected";
    if (!source && !item && Number.isNaN(amount)) continue; // notes in other columns
    if (!(amount > 0)) {
      skipped.push({ row: r, reason: "no amount" });
      continue;
    }
    const base = { row: r, source, entry: (item || source).slice(0, 200), amountEgp: Math.round(amount), partner: null as string | null };
    if (cat === "camp income" || cat === "design house income" || (direction === "in" && !cat)) {
      const core = cat === "design house income";
      ledger.push({ ...base, section: "income", category: core ? "OrlaDent client work" : "Candidate payment", status: done ? "received" : "expected", stream: core ? "core" : "camp" });
    } else if (cat === "partner withdrawal") {
      const p = partners.find((x) => x.toLowerCase() === (partner ?? "").toLowerCase());
      if (!p) {
        skipped.push({ row: r, reason: `unknown partner "${partner ?? ""}"` });
        continue;
      }
      ledger.push({ ...base, section: "partner_withdrawals", category: "Partner withdrawal", status: done ? "paid" : "owed", partner: p, stream: "camp" });
    } else if (cat === "designer cost") {
      ledger.push({ ...base, section: "variable_costs", category: "Production designers", status: done ? "paid" : "owed", stream: "core" });
    } else if (cat.includes("cost") || direction === "out") {
      ledger.push({ ...base, ...costCategory(`${item} ${source}`), status: done ? "paid" : "owed", stream: /design house/i.test(source) ? "core" : "camp" });
    } else skipped.push({ row: r, reason: `unknown category "${s(cells.get("E"))}"` });
  }
  return { ledger, skipped };
}

/** The Assumptions (and Salaries) sheets, read into the finance model on top of the current one. */
function parseModel(all: Sheet[], current: FinanceModel, campSplit: { partners: Share[]; capitalPct: number }): { model: FinanceModel; campSplit: typeof campSplit } | null {
  const a = sheet(all, "Assumptions");
  if (!a) return null;
  const cell = (ref: string) => a.rows.get(Number(ref.slice(1)))?.get(ref[0]);
  const holders: { name: string; camp: number; core: number; next: number }[] = [];
  for (let r = 4; r <= 12; r++) {
    const name = s(a.rows.get(r)?.get("A"));
    if (!name || /^total$/i.test(name)) break;
    holders.push({ name, camp: n(a.rows.get(r)?.get("B")), core: n(a.rows.get(r)?.get("C")), next: n(a.rows.get(r)?.get("D")) });
  }
  const capital = holders.find((h) => /^capital$/i.test(h.name));
  const partners = holders.filter((h) => h !== capital && [h.camp, h.core, h.next].every((x) => Number.isFinite(x)));
  if (!capital || !partners.length) return null;
  const pct = (x: number) => Math.round(x * 10000) / 100; // 0.3 -> 30
  // fixed costs: the build-up block (labels in A, amounts in B) between "Fixed cost build-up" and the low/high cases
  const fixed: FinanceModel["fixedCosts"] = [];
  let inBlock = false;
  for (const [r, cells] of [...a.rows.entries()].sort((x, y) => x[0] - y[0])) {
    const label = s(cells.get("A"));
    if (/fixed cost build-up/i.test(label)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (!label || /low case|high case|reserve|tier/i.test(label)) {
      if (fixed.length) break;
      continue;
    }
    const amount = n(cells.get("B"));
    if (/: low$/i.test(label) || /: high$/i.test(label)) continue;
    if (Number.isFinite(amount)) {
      const lowHigh = /: used/i.test(label);
      const base = label.replace(/:\s*used.*$/i, "").trim();
      const low = lowHigh ? n(a.rows.get(r - 2)?.get("B")) : Number.NaN;
      const high = lowHigh ? n(a.rows.get(r - 1)?.get("B")) : Number.NaN;
      fixed.push({ label: base, amount: Math.round(amount), low: Number.isFinite(low) ? low : null, high: Number.isFinite(high) ? high : null, note: s(cells.get("E")) });
    }
  }
  const tiers: { pool: number }[] = [];
  for (const [, cells] of [...a.rows.entries()].sort((x, y) => x[0] - y[0])) {
    if (/^tier \d+$/i.test(s(cells.get("A"))) && Number.isFinite(n(cells.get("B")))) tiers.push({ pool: Math.round(n(cells.get("B"))) });
  }
  const sal = sheet(all, "Salaries");
  const multipliers = new Map<string, number>();
  // the first table (Partner | Accountable load | Multiplier ...); the later tables repeat the names with money in C
  for (const [, cells] of [...(sal?.rows ?? new Map<number, Map<string, Cell>>()).entries()].sort((x, y) => x[0] - y[0])) {
    const name = s(cells.get("A"));
    const m = n(cells.get("C"));
    if (partners.some((p) => p.name === name) && !multipliers.has(name) && Number.isFinite(m) && m >= 0 && m <= 10) multipliers.set(name, m);
  }
  const seat = n(cell("B13"));
  const reserveMonths = n(cell("B14"));
  const model: FinanceModel = {
    ...current,
    coreSplit: { partners: partners.map((p) => ({ name: p.name, pct: pct(p.core) })), capitalPct: pct(capital.core) },
    newShares: partners.map((p) => ({ name: p.name, pct: pct(p.next) })),
    fixedCosts: fixed.length ? fixed : current.fixedCosts,
    tiers: tiers.length ? tiers : current.tiers,
    seatPrice: Number.isFinite(seat) && seat > 0 ? seat : current.seatPrice,
    reserveMonths: Number.isFinite(reserveMonths) ? reserveMonths : current.reserveMonths,
    partners: partners.map((p) => {
      const cur = current.partners.find((c) => c.name === p.name);
      return { name: p.name, role: cur?.role ?? "", outcome: cur?.outcome ?? "", multiplier: multipliers.get(p.name) ?? cur?.multiplier ?? 1, balancing: cur?.balancing ?? false };
    }),
  };
  if (!model.partners.some((p) => p.balancing)) model.partners[0].balancing = true;
  return { model, campSplit: { partners: partners.map((p) => ({ name: p.name, pct: pct(p.camp) })), capitalPct: pct(capital.camp) } };
}

function parseFunctions(all: Sheet[], partners: string[]): FunctionDraft[] {
  const f = sheet(all, "Function Owners");
  if (!f) return [];
  const header = [...(f.rows.entries())].find(([, c]) => /^function$/i.test(s(c.get("A"))));
  if (!header) return [];
  const [hr, hcells] = header;
  const cols = [...hcells.entries()].filter(([, v]) => partners.includes(s(v))).map(([col, v]) => [col, s(v)] as const);
  const staffCol = [...hcells.entries()].find(([, v]) => /staff/i.test(s(v)))?.[0];
  const out: FunctionDraft[] = [];
  for (const [r, cells] of [...f.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (r <= hr) continue;
    const name = s(cells.get("A"));
    if (!name || /per partner|lines with/i.test(name)) continue;
    const applies = s(cells.get("B")).toLowerCase();
    const weight = n(cells.get("C"));
    const a = cols.filter(([c]) => s(cells.get(c)).toUpperCase() === "A").map(([, p]) => p);
    out.push({
      name: name.slice(0, 120),
      appliesTo: applies === "core" ? "core" : applies === "camp" ? "camp" : "both",
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
      accountable: a[0] ?? null,
      supporting: cols.filter(([c]) => s(cells.get(c)).toUpperCase() === "S").map(([, p]) => p),
      staff: staffCol ? s(cells.get(staffCol)) || null : null,
    });
  }
  return out;
}

export async function previewWorkbook(db: Db, buf: Buffer): Promise<WorkbookPreview> {
  const all = readXlsx(buf);
  const ledgerSheet = sheet(all, "Ledger");
  if (!ledgerSheet) throw new XlsxError("The workbook has no Ledger sheet");
  const settings = await getSettings(db);
  const parsedModel = parseModel(all, settings.financeModel, settings.financeSplit);
  const partners = (parsedModel?.campSplit ?? settings.financeSplit).partners.map((p) => p.name);
  const { ledger, skipped } = parseLedger(ledgerSheet, partners);
  const sum = (f: (d: LedgerDraft) => boolean) => ledger.filter(f).reduce((a, d) => a + d.amountEgp, 0);
  const moved = (d: LedgerDraft) => d.status === "received" || d.status === "paid";
  const totals = {
    campIncome: sum((d) => d.section === "income" && d.stream === "camp"),
    coreIncome: sum((d) => d.section === "income" && d.stream === "core"),
    costs: sum((d) => d.section === "fixed_costs" || d.section === "variable_costs"),
    withdrawals: sum((d) => d.section === "partner_withdrawals"),
    cashToday: sum((d) => d.section === "income" && moved(d)) - sum((d) => d.section !== "income" && moved(d)),
    cashAtClose: sum((d) => d.section === "income") - sum((d) => d.section !== "income"),
  };
  const cp = sheet(all, "Cycle Position");
  const cashRow = cp ? [...cp.rows.values()].find((c) => /^cash in the business$/i.test(s(c.get("A")))) : undefined;
  return {
    hash: createHash("sha256").update(buf).digest("hex").slice(0, 12),
    ledger,
    skipped,
    totals,
    workbookCash: { today: cashRow ? n(cashRow.get("B")) : null, atClose: cashRow ? n(cashRow.get("C")) : null },
    model: parsedModel?.model ?? null,
    campSplit: parsedModel?.campSplit ?? null,
    functions: parseFunctions(all, partners),
  };
}

export type ImportOptions = {
  date: string; // YYYY-MM-DD: the workbook has no dates; rows get this date, marked approximate
  closeDate: string | null; // the cycle close date (the workbook states it only in its notes); null = keep the current one
  replaceLedger: boolean; // archive the ledger rows dated before the cycle close first (restorable from the database)
  model: boolean;
  functions: boolean;
};

/** Writes a previewed workbook. Rows already imported from the same file are skipped. */
export async function importWorkbook(db: Db, buf: Buffer, opts: ImportOptions, userId: number | null) {
  const p = await previewWorkbook(db, buf);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return { ok: false as const, error: "Pick the date for the imported rows" };
  if (opts.closeDate && !/^\d{4}-\d{2}-\d{2}$/.test(opts.closeDate)) return { ok: false as const, error: "Pick the close date" };
  const settings = await getSettings(db);
  const closeDate = opts.closeDate ?? settings.financeModel.closeDate ?? null;
  if (closeDate && opts.date > closeDate) return { ok: false as const, error: "Date the rows on or before the close date, so they belong to the old cycle" };
  const date = cairoLocalToDate(`${opts.date}T12:00`)!;
  return db.transaction(async (tx) => {
    let archived = 0;
    if (opts.replaceLedger) {
      const before = closeDate ? cairoLocalToDate(`${addDaysYmd(closeDate, 1)}T00:00`)! : new Date(8.64e15);
      const rows = await tx
        .update(ledgerEntries)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(isNull(ledgerEntries.deletedAt), sql`${effectiveDate} < ${before.toISOString()}::timestamptz`))
        .returning({ id: ledgerEntries.id });
      archived = rows.length;
    }
    const existing = new Set(
      (await tx.select({ ref: ledgerEntries.reference }).from(ledgerEntries).where(and(isNull(ledgerEntries.deletedAt), like(ledgerEntries.reference, `workbook:${p.hash}:%`)))).map((r) => r.ref),
    );
    let added = 0;
    for (const d of p.ledger) {
      const reference = `workbook:${p.hash}:${d.row}`;
      if (existing.has(reference)) continue;
      await tx.insert(ledgerEntries).values({
        entry: d.entry,
        amountEgp: d.amountEgp,
        date,
        dateApproximate: true,
        section: d.section,
        category: d.category,
        status: d.status,
        partner: d.partner,
        stream: d.stream,
        reference,
        notes: d.source ? `From the cycle close workbook: ${d.source}` : "From the cycle close workbook",
        createdBy: userId,
      });
      added++;
    }
    const model = opts.model && p.model ? p.model : settings.financeModel;
    if ((opts.model && p.model) || closeDate !== settings.financeModel.closeDate) {
      const r = await saveSettings(tx as unknown as Db, { financeModel: { ...model, closeDate }, ...(opts.model && p.campSplit ? { financeSplit: p.campSplit } : {}) }, userId);
      if (!r.ok) throw new Error(r.error);
    }
    let functions = 0;
    if (opts.functions && p.functions.length) {
      await tx.update(businessFunctions).set({ deletedAt: new Date() }).where(isNull(businessFunctions.deletedAt));
      for (const [i, f] of p.functions.entries()) {
        await tx.insert(businessFunctions).values({ ...f, position: i, updatedBy: userId });
        functions++;
      }
    }
    await audit(tx, { userId, entity: "ledger", action: "import_workbook", diff: { file: p.hash, added, archived, model: opts.model && !!p.model, functions } });
    return { ok: true as const, added, archived, skipped: p.ledger.length - added, functions };
  });
}

export { XlsxError };
