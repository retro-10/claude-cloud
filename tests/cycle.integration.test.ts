import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { getSettings, saveSettings } from "@/lib/app-settings";
import {
  approvePay,
  closeCycle,
  legacyBalances,
  listFunctions,
  oldCycle,
  recordLegacy,
  salaries,
  saveReview,
  trigger,
  undoPay,
  waterfall,
} from "@/lib/cycle";
import { saveEntry } from "@/lib/finance";
import { costCategory, importWorkbook, previewWorkbook } from "@/lib/workbook-import";
import { cairoLocalToDate } from "@/lib/time";
import { XlsxError } from "@/lib/xlsx";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
// a synthetic Cycle Close workbook: the real sheets and layout, invented amounts. The expected figures below were
// worked out separately with the workbook's own formulas.
const WORKBOOK = readFileSync(join(__dirname, "fixtures", "cycle-close.xlsx"));
const at = (local: string) => cairoLocalToDate(local)!;

d("the rebuild: workbook import, old-cycle settlement, close, pay tiers, waterfall, legacy ledger", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [{ id: owner }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, "owner")).limit(1);
  });
  afterAll(() => client.end());

  it("previews the workbook: the cash matches the workbook's own figures", async () => {
    const p = await previewWorkbook(db, WORKBOOK);
    expect(p.ledger).toHaveLength(52);
    expect(p.skipped).toEqual([]);
    expect(p.totals).toEqual({ campIncome: 168000, coreIncome: 32000, costs: 65100, withdrawals: 69500, cashToday: 78900, cashAtClose: 65400 });
    expect(p.workbookCash).toEqual({ today: 78900, atClose: 65400 });
    expect(p.model).toMatchObject({ coreSplit: { capitalPct: 20 }, tiers: [{ pool: 10000 }, { pool: 20000 }, { pool: 30000 }], seatPrice: 9000, reserveMonths: 2 });
    expect(p.model!.fixedCosts.map((f) => [f.label, f.amount, f.low, f.high])).toEqual([["Salaries", 5000, null, null], ["Editor", 5000, 4000, 6000], ["Software subscriptions", 1000, null, null], ["Ads tools", 500, null, null]]);
    expect(p.model!.partners.map((x) => [x.name, x.multiplier])).toEqual([["Badr", 1], ["Sayyed", 1], ["Retro", 1], ["Mo", 2]]);
    expect(p.campSplit).toEqual({ partners: [{ name: "Badr", pct: 30 }, { name: "Sayyed", pct: 20 }, { name: "Retro", pct: 15 }, { name: "Mo", pct: 15 }], capitalPct: 20 });
    expect(p.functions).toHaveLength(10);
    expect(p.functions.find((f) => f.name === "Function seven")).toMatchObject({ appliesTo: "core", weight: 0.5, accountable: "Retro", supporting: ["Sayyed"] });
    await expect(previewWorkbook(db, Buffer.from("not a zip"))).rejects.toBeInstanceOf(XlsxError);
    expect(costCategory("Marketing salary")).toEqual({ section: "fixed_costs", category: "Salaries" });
    expect(costCategory("Claude")).toEqual({ section: "fixed_costs", category: "Subscriptions" });
    expect(costCategory("Reels")).toEqual({ section: "variable_costs", category: "Content creator" });
  });

  it("imports once: the ledger, the finance model and the functions; a second import adds nothing", async () => {
    await saveEntry(db, null, { entry: "Old guess", amountEgp: 999, section: "income", category: "Candidate payment", status: "received", date: at("2026-10-01T10:00") }, owner);
    expect(await importWorkbook(db, WORKBOOK, { date: "2026-11-02", closeDate: "2026-10-30", replaceLedger: true, model: true, functions: true }, owner)).toMatchObject({ ok: false, error: expect.stringContaining("on or before the close") });
    const r = await importWorkbook(db, WORKBOOK, { date: "2026-10-25", closeDate: "2026-10-30", replaceLedger: true, model: true, functions: true }, owner);
    expect(r).toMatchObject({ ok: true, added: 52, archived: 1, functions: 10 });
    expect((await getSettings(db)).financeModel.closeDate).toBe("2026-10-30");
    const again = await importWorkbook(db, WORKBOOK, { date: "2026-10-25", closeDate: null, replaceLedger: false, model: false, functions: false }, owner);
    expect(again).toMatchObject({ ok: true, added: 0 });
    const live = await db.select().from(s.ledgerEntries).where(isNull(s.ledgerEntries.deletedAt));
    expect(live).toHaveLength(52);
    expect(live.every((e) => e.dateApproximate)).toBe(true);
    expect(live.filter((e) => e.stream === "core").reduce((a, e) => a + e.amountEgp, 0)).toBe(32000 + 20000);
  });

  it("the old cycle today and at the close, and the settlement, match the workbook's formulas", async () => {
    const c = (await oldCycle(db))!;
    const today = Object.fromEntries(c.today.holders.map((h) => [h.name, h.balance]));
    expect(today).toEqual({ Badr: 46900, Sayyed: 33600, Retro: -23250, Mo: 29250, Capital: -7600 });
    expect(c.today.cash).toBe(78900);
    const close = Object.fromEntries(c.atClose.holders.map((h) => [h.name, Math.round(h.settled)]));
    expect(close).toEqual({ Badr: 38988, Sayyed: 28325, Retro: -27206, Mo: 25294, Capital: 0 });
    expect(c.atClose.holders.find((h) => h.name === "Capital")!.balance).toBe(-25100);
    expect(c.atClose.cash).toBe(65400);
    expect(c.atClose.check).toBe(true);
    expect(c.atClose.owedToPartners).toBeCloseTo(92606.25, 2);
    expect(c.atClose.owedByPartners).toBeCloseTo(27206.25, 2);
  });

  it("salaries follow the accountable load; tiers unlock at the plan's triggers", async () => {
    const { financeModel: m } = await getSettings(db);
    const sal = salaries(m, ["Badr", "Sayyed", "Retro", "Mo"], await listFunctions(db));
    // loads 2, 2.5, 3.5 and 1 x 2 (multiplier): shares 20%, 25%, 35%, 20%; Mo takes the rounding
    expect(sal.map((p) => [p.name, p.accountable, p.x])).toEqual([
      ["Badr", 2, [2000, 4000, 6000]],
      ["Sayyed", 2.5, [2500, 5000, 7500]],
      ["Retro", 3.5, [3500, 7000, 10500]],
      ["Mo", 1, [2000, 4000, 6000]],
    ]);
    // (11,500 fixed + pool) x 1.25, to the nearest 5,000
    expect(m.tiers.map((t) => trigger(m, t.pool))).toEqual([25000, 40000, 50000]);
    // no functions: the pool is shared equally
    expect(salaries(m, ["Badr", "Sayyed", "Retro", "Mo"], []).map((p) => p.x[0])).toEqual([2500, 2500, 2500, 2500]);
    // rounding: the balancing partner takes the difference so X adds up to the pool
    expect(salaries({ ...m, tiers: [{ pool: 10000 }] }, ["Badr", "Sayyed", "Retro"], []).map((p) => p.x[0])).toEqual([3300, 3300, 3400]);
  });

  it("closes once, after the close date, opening the legacy ledger", async () => {
    expect(await closeCycle(db, owner, at("2026-10-30T20:00"))).toMatchObject({ ok: false });
    expect(await closeCycle(db, owner, at("2026-10-31T09:00"))).toMatchObject({ ok: true });
    expect(await closeCycle(db, owner, at("2026-11-01T09:00"))).toMatchObject({ ok: false, error: expect.stringContaining("already closed") });
    const bal = Object.fromEntries((await legacyBalances(db)).map((b) => [b.partner, b.balance]));
    expect(bal).toEqual({ Badr: 38988, Sayyed: 28325, Retro: -27206, Mo: 25294 });
  });

  it("the waterfall: costs first, reserve, base pay at the unlocked tier, KPI pay, 20% retained, equal shares; Retro's pay withheld", async () => {
    // the expected rows of the old cycle came in; a new month's income
    for (const e of await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.status, "expected"))) await db.update(s.ledgerEntries).set({ status: "received" }).where(eq(s.ledgerEntries.id, e.id));
    for (const e of await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.status, "owed"))) await db.update(s.ledgerEntries).set({ status: "paid" }).where(eq(s.ledgerEntries.id, e.id));
    await saveEntry(db, null, { entry: "Seats, November", amountEgp: 45000, section: "income", category: "Candidate payment", status: "received", date: at("2026-11-10T12:00") }, owner);
    await saveEntry(db, null, { entry: "Seats, December", amountEgp: 60000, section: "income", category: "Candidate payment", status: "received", date: at("2026-12-10T12:00") }, owner);
    await saveEntry(db, null, { entry: "December costs", amountEgp: 16500, section: "fixed_costs", category: "Salaries", status: "paid", date: at("2026-12-20T12:00") }, owner);

    // the workbook keeps 20% of profit in a formula, not an input: set it as the owners would in Settings
    const st = await getSettings(db);
    expect(await saveSettings(db, { financeModel: { ...st.financeModel, retainPct: 20 } }, owner)).toEqual({ ok: true });
    const nov = await waterfall(db, "2026-11");
    expect(nov.tier).toBe(0); // October's new-cycle part (one day) had no income: not two months running
    expect(nov.partners.every((p) => p.base === 0)).toBe(true);

    const dec0 = await waterfall(db, "2026-12");
    expect(dec0.tier).toBe(2); // November 45,000 and December 60,000 both clear Tier 2 (40,000), not Tier 3 (50,000)
    expect(dec0.missingScores).toEqual(["Badr", "Sayyed", "Retro", "Mo"]);
    expect(await approvePay(db, "2026-12", owner, at("2027-01-05T10:00"))).toMatchObject({ ok: false, error: expect.stringContaining("Score") });
    await saveReview(db, "2026-12", ["Badr", "Sayyed", "Retro", "Mo"].map((p) => ({ partner: p, kpiScore: 70 })), owner);

    const dec = await waterfall(db, "2026-12");
    expect(dec).toMatchObject({ income: 60000, costs: 16500, cashAfterCosts: 43500, reserveTopUp: 0, pool: 20000, basePaid: 10000 });
    expect(Math.round(dec.kpiPaid)).toBe(28000); // 70% x 2 x 20,000
    expect(Math.round(dec.profit)).toBe(5500);
    expect(Math.round(dec.retained)).toBe(1100);
    const retro = dec.partners.find((p) => p.name === "Retro")!;
    expect(Math.round(retro.due)).toBe(3500 + 9800 + 1100); // base X/2 + KPI 70% x 2X + a quarter of 4,400
    expect(Math.round(retro.withheld)).toBe(14400); // all of it: Retro owes the legacy ledger more
    expect(Math.round(dec.partners.find((p) => p.name === "Mo")!.paid)).toBe(2000 + 5600 + 1100);
  });

  it("approval books the pay as Owed and moves withheld pay into the legacy ledger; undo puts it back", async () => {
    expect(await approvePay(db, "2026-12", owner, at("2026-12-20T10:00"))).toMatchObject({ ok: false, error: expect.stringContaining("over") });
    expect(await approvePay(db, "2026-12", owner, at("2027-01-05T10:00"))).toMatchObject({ ok: true });
    expect(await saveReview(db, "2026-12", [{ partner: "Mo", kpiScore: 100 }], owner)).toMatchObject({ ok: false });
    const pay = await db.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.section, "partner_withdrawals"), eq(s.ledgerEntries.status, "owed"), isNull(s.ledgerEntries.deletedAt)));
    expect(pay.filter((e) => e.partner === "Retro")).toEqual([]);
    expect(pay.filter((e) => e.partner === "Mo").map((e) => [e.category, e.amountEgp]).sort()).toEqual([["Partner KPI pay", 5600], ["Partner base pay", 2000], ["Profit distribution", 1100]]);
    expect((await legacyBalances(db)).find((b) => b.partner === "Retro")!.balance).toBe(-27206 + 14400);
    expect((await waterfall(db, "2026-12")).approved).not.toBeNull();

    expect(await undoPay(db, "2026-12", owner)).toEqual({ ok: true });
    expect((await legacyBalances(db)).find((b) => b.partner === "Retro")!.balance).toBe(-27206);
    expect((await db.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.status, "owed"), isNull(s.ledgerEntries.deletedAt))))).toEqual([]);
  });

  it("legacy payments move cash and the balance; adjustments move only the balance", async () => {
    expect(await recordLegacy(db, { partner: "Badr", kind: "payment", amountEgp: 60000 }, owner)).toMatchObject({ ok: false });
    expect(await recordLegacy(db, { partner: "Badr", kind: "payment", amountEgp: 10000, note: "First instalment" }, owner)).toEqual({ ok: true });
    expect(await recordLegacy(db, { partner: "Retro", kind: "payment", amountEgp: 1000 }, owner)).toEqual({ ok: true }); // Retro repays
    expect(await recordLegacy(db, { partner: "Nobody", kind: "adjustment", amountEgp: 5 }, owner)).toMatchObject({ ok: false });
    expect(await recordLegacy(db, { partner: "Mo", kind: "adjustment", amountEgp: -129, note: "Rounding agreed" }, owner)).toEqual({ ok: true });
    const bal = Object.fromEntries((await legacyBalances(db)).map((b) => [b.partner, b.balance]));
    expect(bal).toEqual({ Badr: 28988, Sayyed: 28325, Retro: -26206, Mo: 25165 });
    const cash = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.category, "Legacy settlement"));
    expect(cash.map((e) => [e.partner, e.amountEgp, e.status])).toEqual([["Badr", 10000, "paid"]]);
    // legacy money is not the new cycle's income
    expect((await waterfall(db, "2026-10")).income).toBe(0);
  });
});
