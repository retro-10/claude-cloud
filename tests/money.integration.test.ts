import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { budgetVsActual, cashForecast, copyBudget, saveBudget, unitEconomics } from "@/lib/money";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const at = (local: string) => cairoLocalToDate(local)!;

d("budget, cash forecast and unit economics", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, batch: number;
  const now = at("2026-10-05T10:00"); // a Monday

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await client.unsafe("delete from cohorts");
    owner = (await db.select().from(s.users))[0].id;
    [{ id: batch }] = await db.insert(s.cohorts).values({ name: "Batch 9", seatCap: 40 }).returning();
    const cost = (entry: string, amountEgp: number, date: string, status: "paid" | "owed", category: string, extra: Partial<typeof s.ledgerEntries.$inferInsert> = {}) =>
      ({ entry, amountEgp, date: at(date), section: "variable_costs" as const, category, status, ...extra });
    await db.insert(s.ledgerEntries).values([
      cost("Meta ads", 8000, "2026-10-02T12:00", "paid", "Ads & promotion"),
      cost("More ads", 4000, "2026-10-20T12:00", "owed", "Ads & promotion"),
      cost("Video edit", 3000, "2026-10-12T12:00", "paid", "Video production", { cohortId: batch }),
      cost("Old bill", 500, "2026-09-28T12:00", "owed", "Equipment"), // past its date: late
      { entry: "Studio", amountEgp: 6000, date: at("2026-10-01T12:00"), section: "fixed_costs", category: "Subscriptions", status: "paid", cohortId: batch },
    ]);
    // three students: two paying in instalments, one dropped
    const mk = async (name: string, status: "active" | "dropped", amount: number, discount: number) => {
      const [l] = await db.insert(s.leads).values({ fullName: name, createdAt: at("2026-09-20T12:00") }).returning();
      const [e] = await db.insert(s.enrolments).values({ leadId: l.id, cohortId: batch, tier: "foundation", amountEgp: amount, discountEgp: discount, status, createdAt: at("2026-09-25T12:00") }).returning();
      return e.id;
    };
    const e1 = await mk("A", "active", 7500, 500);
    const e2 = await mk("B", "active", 7500, 0);
    const e3 = await mk("C", "dropped", 7500, 0);
    const inc = (enrolmentId: number, amountEgp: number, date: string, status: "received" | "expected") => ({ entry: "pay", amountEgp, date: at(date), section: "income" as const, category: "Candidate payment", status, enrolmentId, cohortId: batch });
    await db.insert(s.ledgerEntries).values([
      inc(e1, 3500, "2026-09-26T12:00", "received"),
      inc(e1, 3500, "2026-10-15T12:00", "expected"),
      inc(e2, 7500, "2026-09-27T12:00", "received"),
      inc(e3, 2000, "2026-09-27T12:00", "received"),
      inc(e3, 5500, "2026-10-20T12:00", "expected"), // dropped: never counted as coming in
      inc(e2, 999, "2026-10-01T12:00", "expected"), // already late
    ]);
  });
  afterAll(() => client.end());

  it("budget vs actual: paid and owed against each budget; over and unplanned flagged", async () => {
    expect(await saveBudget(db, "2026-10", [{ section: "variable_costs", category: "Ads & promotion", amountEgp: 10000 }, { section: "fixed_costs", category: "Subscriptions", amountEgp: 6000 }, { section: "variable_costs", category: "Video production", amountEgp: 5000 }], owner)).toEqual({ ok: true });
    expect(await saveBudget(db, "2026-13", [], owner)).toMatchObject({ ok: false });
    const { rows, totals } = await budgetVsActual(db, "2026-10");
    const row = (c: string) => rows.find((r) => r.category === c)!;
    expect(row("Ads & promotion")).toMatchObject({ budget: 10000, paid: 8000, owed: 4000, left: -2000, over: true, unplanned: false });
    expect(row("Video production")).toMatchObject({ budget: 5000, paid: 3000, owed: 0, left: 2000, over: false });
    expect(row("Subscriptions")).toMatchObject({ budget: 6000, paid: 6000, left: 0, over: false });
    expect(totals).toMatchObject({ budget: 21000, paid: 17000, owed: 4000 });
    // September: the old bill had no budget
    expect((await budgetVsActual(db, "2026-09")).rows.find((r) => r.category === "Equipment")).toMatchObject({ unplanned: true, owed: 500 });
    // a zero removes the line; copying fills an empty month
    await saveBudget(db, "2026-10", [{ section: "variable_costs", category: "Video production", amountEgp: 0 }], owner);
    expect((await budgetVsActual(db, "2026-10")).totals.budget).toBe(16000);
    expect(await copyBudget(db, "2026-11", owner)).toMatchObject({ copied: 2 });
    expect((await budgetVsActual(db, "2026-11")).totals.budget).toBe(16000);
  });

  it("cash forecast: what is due in and owed out by week; late kept apart; unbooked budget spread over the month", async () => {
    const f = await cashForecast(db, { now, opening: 10000 });
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[0].start).toBe("2026-10-05");
    // week 2 (12–18 Oct): the instalment of 3,500 comes in; week 3 (19–25 Oct): 4,000 of ads owed out
    expect(f.weeks[1]).toMatchObject({ in: 3500, out: 0 });
    expect(f.weeks[2]).toMatchObject({ in: 0, out: 4000 }); // the dropped student's 5,500 is not expected
    expect(f.late).toEqual({ in: 999, out: 500 });
    // October's budget is fully booked (16,000 against 21,000 spent); November's 16,000 is spread over its 30 days
    const planned = f.weeks.reduce((a, w) => a + w.planned, 0);
    expect(Math.abs(planned - 16000)).toBeLessThanOrEqual(13); // rounding per week
    expect(f.weeks.find((w) => w.start === "2026-10-26")!.planned).toBeGreaterThan(0); // the week reaching into November
    expect(f.weeks[f.weeks.length - 1].running).toBe(10000 + f.weeks.reduce((a, w) => a + w.net, 0));
  });

  it("unit economics: batch margin from tagged costs; marketing per lead and enrolment", async () => {
    const u = await unitEconomics(db, { from: at("2026-09-01T00:00"), to: at("2026-10-31T00:00") });
    const b = u.perBatch.find((x) => x.id === batch)!;
    // revenue: 7,000 + 7,500 + the dropped student's 2,000 (what they kept paid); costs tagged: 3,000 + 6,000
    expect(b).toMatchObject({ students: 2, revenue: 16500, received: 13000, costs: 9000, margin: 7500 });
    expect(b.perStudent).toBe(8250);
    // marketing: paid ads only (8,000); 3 leads, 3 enrolments
    expect(u.marketing).toMatchObject({ spend: 8000, leads: 3, enrolments: 3, costPerLead: 2667, costPerEnrolment: 2667 });
    expect(u.perCaseType).toEqual([]);
  });
});
