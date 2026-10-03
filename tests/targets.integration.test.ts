import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createLead } from "@/lib/leads";
import { progressFor, quarterOf, quarterRange, saveTarget, shiftQuarter } from "@/lib/targets";
import { withoutRelease11Rules } from "./base-rules";

describe("quarters follow the Cairo calendar", () => {
  it("names the quarter, shifts across years, and gives Cairo-midnight edges", () => {
    expect(quarterOf(new Date("2026-09-30T20:59:00Z"))).toBe("2026-Q3"); // 23:59 in Cairo
    expect(quarterOf(new Date("2026-09-30T21:30:00Z"))).toBe("2026-Q4"); // 00:30 on 1 October in Cairo
    expect(shiftQuarter("2026-Q4", 1)).toBe("2027-Q1");
    expect(shiftQuarter("2026-Q1", -1)).toBe("2025-Q4");
    const [a, b] = quarterRange("2026-Q4");
    expect(a.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(b.toISOString()).toBe("2026-12-31T22:00:00.000Z"); // Cairo is UTC+2 in winter
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("targets", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users))[0].id;
    for (let i = 0; i < 6; i++) {
      const l = await createLead(db, { fullName: `T${i}`, phone: `0101111000${i}` }, userId);
      if (!l.ok) throw new Error("setup");
    }
    // five leads in Q4 2026, one before it
    await client`update leads set created_at = '2026-10-10T10:00:00Z'`;
    await client`update leads set created_at = '2026-09-10T10:00:00Z' where full_name = 'T0'`;
    await db.insert(s.ledgerEntries).values([
      { entry: "Payment", amountEgp: 10000, section: "income", category: "Candidate payment", status: "received", date: new Date("2026-10-20T10:00:00Z") },
      { entry: "Refund", amountEgp: 2000, section: "income", category: "Refund", status: "received", date: new Date("2026-11-02T10:00:00Z") },
      { entry: "Later", amountEgp: 5000, section: "income", category: "Candidate payment", status: "expected", date: new Date("2026-11-20T10:00:00Z") },
    ]);
  });
  afterAll(() => client.end());

  it("measures the quarter and judges pace: on track, at risk, behind, done", async () => {
    // halfway through Q4 (15 November 2026 is about 49% in)
    const mid = new Date("2026-11-15T10:00:00Z");
    await saveTarget(db, "leads", "2026-Q4", 10, userId); // 5 of 10, expected ~5: on track
    await saveTarget(db, "cash_egp", "2026-Q4", 20000, userId); // 8,000 of 20,000, expected ~9,800: at risk
    await saveTarget(db, "enrolments", "2026-Q4", 10, userId); // 0 of 10: behind
    await saveTarget(db, "consults_held", "2026-Q4", 0, userId); // 0 = no target
    const p = await progressFor(db, "2026-Q4", mid);
    const by = Object.fromEntries(p.rows.map((r) => [r.metric, r]));
    expect(by.leads).toMatchObject({ actual: 5, target: 10, status: "on_track", pct: 50 });
    expect(by.cash_egp).toMatchObject({ actual: 8000, target: 20000, status: "at_risk" });
    expect(by.enrolments).toMatchObject({ actual: 0, status: "behind" });
    expect(by.consults_held).toMatchObject({ target: null, status: "no_target" });

    await saveTarget(db, "leads", "2026-Q4", 5, userId);
    expect((await progressFor(db, "2026-Q4", mid)).rows.find((r) => r.metric === "leads")!.status).toBe("done");
    // after the quarter, a missed target reads as ended short
    expect((await progressFor(db, "2026-Q4", new Date("2027-01-05T10:00:00Z"))).rows.find((r) => r.metric === "enrolments")!.status).toBe("ended_short");
  });

  it("clearing a target removes it; bad values are refused", async () => {
    await saveTarget(db, "enrolments", "2026-Q4", null, userId);
    expect((await progressFor(db, "2026-Q4")).rows.find((r) => r.metric === "enrolments")!.target).toBeNull();
    expect(await saveTarget(db, "leads", "2026-Q9", 5, userId)).toEqual({ ok: false, error: "Unknown target" });
    expect(await saveTarget(db, "leads", "2026-Q4", -3, userId)).toEqual({ ok: false, error: "A target is a whole number" });
  });
});
