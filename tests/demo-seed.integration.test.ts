import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedDemoIfEmpty, seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { getMetrics } from "@/lib/metrics";
import { addDaysYmd, cairoYmd } from "@/lib/time";
import { getToday } from "@/lib/today";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("demo data for a fresh clone", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const now = new Date("2026-11-18T10:00:00Z"); // a Wednesday, well away from the fixed dataset dates

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
  });
  afterAll(() => client.end());

  it("adds the demo leads once, only into an empty database", async () => {
    expect(await seedDemoIfEmpty(url, now)).toBe(true);
    expect(await seedDemoIfEmpty(url, now)).toBe(false);
    expect((await client`select count(*)::int as n from leads`)[0].n).toBe(20);
    // the placeholder cohort is replaced by the two demo cohorts
    expect((await db.select().from(s.cohorts)).map((c) => c.name).sort()).toEqual(["Demo Cohort A", "Demo Cohort B"]);
  });

  it("never touches a database that already has leads", async () => {
    await client.unsafe("delete from consult_objections; delete from consults; delete from ledger_entries; delete from enrolments; delete from activities; delete from stage_events; delete from follow_ups; delete from leads;");
    await client`insert into leads (full_name) values ('Real Person')`;
    expect(await seedDemoIfEmpty(url, now)).toBe(false);
    expect((await client`select count(*)::int as n from leads`)[0].n).toBe(1);
  });

  it("dates are shifted to end near 'now', so the default 90-day dashboard and Today are populated", async () => {
    await client.unsafe("delete from leads; delete from stage_events; delete from cohorts; delete from campaigns");
    expect(await seedDemoIfEmpty(url, now)).toBe(true);
    const from = addDaysYmd(cairoYmd(now), -90);
    const m = await getMetrics(db, { from }, now);
    expect(m.totalLeads).toBe(20);
    expect(m.revenue.totalEgp).toBe(60000);
    expect(m.consults.pending).toBe(2); // lead 12's consult, plus the one booked for later today

    const t = await getToday(db, { now });
    expect(t.overdue.length).toBeGreaterThan(0);
    expect(t.dueToday.length).toBeGreaterThan(0);
    expect(t.consultsToday).toHaveLength(1);
    expect(t.queue.filter((q) => q.reason === "new").length).toBe(2); // demo leads 16 and 17
    expect(t.decisionsDue.map((l) => l.fullName)).toEqual(["Demo Lead 13"]);
  });
});
