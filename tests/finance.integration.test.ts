import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { entryProblem, financeBoard, listEntries, monthRange, saveEntry, shiftMonth, type EntryInput } from "@/lib/finance";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const SPLIT = { partners: [{ name: "Badr", pct: 30 }, { name: "Sayyed", pct: 20 }, { name: "Retro", pct: 15 }, { name: "Mo", pct: 15 }], capitalPct: 20 };

d("finance: the books follow the Finances page rules", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const add = async (e: Partial<EntryInput> & Pick<EntryInput, "section" | "category" | "status" | "amountEgp">, date: string | null) => {
    const r = await saveEntry(db, null, { entry: e.category, ...e, date: date ? new Date(date) : null }, null);
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await add({ section: "income", category: "OrlaDent client work", status: "received", amountEgp: 20000 }, "2026-09-05T10:00:00Z");
    // 00:30 on 1 October in Cairo (UTC+3): October's money, not September's
    await add({ section: "income", category: "Candidate payment", status: "received", amountEgp: 10000 }, "2026-09-30T21:30:00Z");
    await add({ section: "income", category: "Refund", status: "received", amountEgp: 2000 }, "2026-09-12T10:00:00Z");
    await add({ section: "income", category: "Candidate payment", status: "expected", amountEgp: 5000 }, "2026-09-20T10:00:00Z");
    await add({ section: "income", category: "OrlaDent client work", status: "cancelled", amountEgp: 9999 }, "2026-09-21T10:00:00Z");
    await add({ section: "fixed_costs", category: "Subscriptions", status: "paid", amountEgp: 1000 }, "2026-09-02T10:00:00Z");
    await add({ section: "variable_costs", category: "Equipment", status: "paid", amountEgp: 500 }, "2026-09-03T10:00:00Z");
    await add({ section: "variable_costs", category: "Video production", status: "owed", amountEgp: 700 }, "2026-09-25T10:00:00Z");
    await add({ section: "partner_withdrawals", category: "Partner withdrawal", status: "paid", partner: "Badr", amountEgp: 3000 }, "2026-09-15T10:00:00Z");
  });
  afterAll(() => client.end());

  it("net income = received − refunds; costs and Expected/Owed/Cancelled rows are not income", async () => {
    const b = await financeBoard(db, "2026-09");
    expect(b.month_).toMatchObject({ income: 20000, refunds: 2000, net: 18000, costs: 1500, fixedCosts: 1000, variableCosts: 500 });
  });

  it("the split: 30/20/15/15 to partners, 20 to Capital, and costs come out of Capital", async () => {
    const m = (await financeBoard(db, "2026-09")).month_;
    expect(m.shares.map((p) => [p.name, p.share])).toEqual([
      ["Badr", 5400],
      ["Sayyed", 3600],
      ["Retro", 2700],
      ["Mo", 2700],
    ]);
    expect(m.capitalShare).toBe(3600);
    expect(m.capitalLeft).toBe(2100);
    // every pound of net income is accounted for
    expect(m.shares.reduce((a, p) => a + p.share, 0) + m.capitalShare).toBe(m.net);
  });

  it("a withdrawal is an advance on that partner's share; balances run to the end of the month shown", async () => {
    const sep = await financeBoard(db, "2026-09");
    expect(sep.balances.find((p) => p.name === "Badr")).toEqual({ name: "Badr", share: 5400, withdrawn: 3000, balance: 2400 });
    const oct = await financeBoard(db, "2026-10");
    expect(oct.month_.income).toBe(10000);
    expect(oct.balances.find((p) => p.name === "Badr")).toEqual({ name: "Badr", share: 8400, withdrawn: 3000, balance: 5400 });
    expect(oct.capitalBalance).toBe(5600 - 1500);
    expect(oct.series.at(-1)).toMatchObject({ month: "2026-10", income: 10000, costs: 0 });
    expect(oct.series.at(-2)).toMatchObject({ month: "2026-09", income: 18000, costs: 1500, net: 16500 });
  });

  it("coming up lists what is still Expected or Owed", async () => {
    const b = await financeBoard(db, "2026-09");
    expect(b.comingUp.map((e) => [e.status, e.amountEgp]).sort()).toEqual([
      ["expected", 5000],
      ["owed", 700],
    ]);
  });

  it("a changed split applies to every month (it is a rule, not a record)", async () => {
    expect((await saveSettings(db, { financeSplit: { partners: [{ name: "Badr", pct: 50 }], capitalPct: 40 } }, null)).ok).toBe(false); // not 100
    expect((await saveSettings(db, { financeSplit: { partners: [{ name: "Badr", pct: 80 }], capitalPct: 20 } }, null)).ok).toBe(true);
    expect((await financeBoard(db, "2026-09")).month_.shares).toEqual([{ name: "Badr", pct: 80, share: 14400, withdrawn: 3000 }]);
    await saveSettings(db, { financeSplit: SPLIT }, null);
  });

  it("rows are validated: a withdrawal names a partner, statuses fit the section, only income links to a candidate", () => {
    const base = { entry: "x", amountEgp: 100, category: "Equipment" } as const;
    expect(entryProblem({ ...base, section: "partner_withdrawals", category: "Partner withdrawal", status: "paid" }, SPLIT)).toMatch(/partner/);
    expect(entryProblem({ ...base, section: "variable_costs", status: "received" }, SPLIT)).toMatch(/Variable costs can be/);
    expect(entryProblem({ ...base, section: "variable_costs", status: "paid", enrolmentId: 1 }, SPLIT)).toMatch(/Only income/);
    expect(entryProblem({ ...base, amountEgp: 0, section: "variable_costs", status: "paid" }, SPLIT)).toMatch(/Amount/);
    expect(entryProblem({ ...base, section: "variable_costs", status: "paid" }, SPLIT)).toBeNull();
  });

  it("months are Cairo months, and the ledger filters by them", async () => {
    const [a, b] = monthRange("2026-10");
    expect(a.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(b.toISOString()).toBe("2026-10-31T22:00:00.000Z"); // DST ends on the last Thursday of October
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect((await listEntries(db, { month: "2026-10" })).map((r) => r.e.amountEgp)).toEqual([10000]);
    expect((await listEntries(db, { q: "equip" })).map((r) => r.e.category)).toEqual(["Equipment"]);
  });
});

d("migration 0004 keeps every recorded payment", () => {
  const client = postgres(url ?? "postgres://x", { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    // migrate to 0003 only, from a copy of the migrations folder with a shortened journal
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    cpSync("./drizzle", dir, { recursive: true });
    const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 3);
    writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    await migrate(drizzle(client), { migrationsFolder: dir });
    await client.unsafe(`
      insert into stages (key, label, position, kind) values ('new', 'New', 0, 'open'), ('enrolled', 'Enrolled', 7, 'won');
      insert into leads (full_name, stage) values ('Paid One', 'enrolled'), ('Unpaid Two', 'enrolled');
      insert into cohorts (name, seat_cap) values ('Old batch', 40);
      insert into enrolments (lead_id, cohort_id, tier, amount_egp, paid_at, payment_ref, gateway)
        values (1, 1, 'foundation', 7500, '2026-09-10T10:00:00Z', 'PM-1', 'paymob'), (2, 1, 'freelance_ready', 15000, null, 'LINK-2', 'paymob');
    `);
  });
  afterAll(() => client.end());

  it("each paid enrolment becomes one Received ledger row; an unpaid reference is kept in the notes", async () => {
    await runMigrations(url);
    const rows = await client`select entry, amount_egp, status, section, category, reference, enrolment_id, cohort_id, date from ledger_entries`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entry: "Paid One — payment", amount_egp: 7500, status: "received", section: "income", category: "Candidate payment", reference: "PM-1", enrolment_id: 1, cohort_id: 1 });
    expect(new Date(rows[0].date as string).toISOString()).toBe("2026-09-10T10:00:00.000Z");
    const [unpaid] = await client`select notes, payment_plan, discount_egp from enrolments where id = 2`;
    expect(unpaid).toMatchObject({ notes: "Payment reference: LINK-2", payment_plan: "one_time", discount_egp: 0 });
    const cols = await client`select column_name from information_schema.columns where table_name = 'enrolments'`;
    expect(cols.map((c) => c.column_name)).not.toContain("paid_at");
  });
});
