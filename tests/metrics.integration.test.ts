import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import { DEMO_START_ISO, insertDemo } from "@/db/demo-data";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { getMetrics } from "@/lib/metrics";
import { fmtRate } from "@/lib/metrics-format";

/**
 * Every expected number below was worked out by hand from the table in src/db/demo-data.ts.
 * Dataset "now" is 2026-09-10; leads were created 3 Aug - 28 Aug 2026.
 */
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const NOW = new Date("2026-09-10T12:00:00Z");
const counts = (m: { funnel: { key: string; count: number }[] }) => Object.fromEntries(m.funnel.map((f) => [f.key, f.count]));

d("dashboard metrics against the hand-checked demo dataset", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const M = (f = {}) => getMetrics(db, f, NOW);

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await insertDemo(db, new Date(DEMO_START_ISO));
  });
  afterAll(() => client.end());

  it("funnel: leads that ever reached each stage, and stage-to-stage conversion", async () => {
    const m = await M();
    expect(m.totalLeads).toBe(20);
    expect(counts(m)).toEqual({ new: 20, contacted: 18, replied: 13, consult_booked: 11, consult_held: 9, offer_sent: 7, enrolled: 5 });
    expect(m.sideStages.map((x) => [x.key, x.count])).toEqual([["lost", 6], ["nurture", 2]]);
    const conv = m.funnel.map((f) => (f.conversion ? Math.round(f.conversion.pct! * 10) / 10 : null));
    expect(conv).toEqual([null, 90, 72.2, 84.6, 81.8, 77.8, 71.4]);
    expect(m.funnel.map((f) => (f.conversion ? fmtRate(f.conversion) : "-"))).toEqual(["-", "90.0%", "72.2%", "84.6%", "81.8%", "77.8%", "71.4%"]);
  });

  it("funnel does not depend on a lead's current stage", async () => {
    // pretend lead 1 (enrolled) was later dragged to nurture, and a lost lead was put back to new
    await client`update leads set stage = 'nurture' where full_name = 'Demo Lead 01'`;
    await client`update leads set stage = 'new' where full_name = 'Demo Lead 06'`;
    expect(counts(await M())).toEqual({ new: 20, contacted: 18, replied: 13, consult_booked: 11, consult_held: 9, offer_sent: 7, enrolled: 5 });
    await client`update leads set stage = 'enrolled' where full_name = 'Demo Lead 01'`;
    await client`update leads set stage = 'lost' where full_name = 'Demo Lead 06'`;
  });

  it("speed: median minutes to first contact and share contacted within 5 minutes", async () => {
    const { speed } = await M();
    expect(speed.contacted).toBe(18);
    expect(speed.uncontacted).toBe(2);
    expect(speed.medianMinutes).toBe(7); // 1,2,3,3,4,4,5,5,6,8,10,15,20,30,45,60,90,120
    expect(speed.within5).toMatchObject({ num: 8, den: 20 });
    expect(fmtRate(speed.within5)).toBe("40.0%");
  });

  it("consults: booked, held, show-up rate, consult-to-enrolment rate", async () => {
    const { consults } = await M();
    expect(consults).toMatchObject({ booked: 11, held: 9, noShow: 1, pending: 1, awaiting: 0 }); // 9 + 1 + 1 + 0 = 11
    expect(fmtRate(consults.showUp)).toBe("90.0%"); // 9 held / (9 held + 1 no-show); the pending one is ignored
    expect(consults.toEnrolment).toMatchObject({ num: 5, den: 9 });
    expect(fmtRate(consults.toEnrolment)).toBe("55.6%");
  });

  it("sales cycle: median days from creation to enrolment", async () => {
    expect((await M()).cycle).toEqual({ enrolled: 5, medianDays: 10 }); // 7,9,10,14,21
  });

  it("revenue: total, collected, by tier, by cohort, by source; totals match the enrolment rows", async () => {
    const { revenue } = await M();
    expect(revenue).toMatchObject({ totalEgp: 60000, collectedEgp: 45000, enrolments: 5 });
    expect(revenue.byTier).toEqual([
      { tier: "freelance_ready", count: 3, egp: 45000 },
      { tier: "foundation", count: 2, egp: 15000 },
    ]);
    expect(revenue.byCohort).toEqual([
      { id: expect.any(Number), name: "Demo Cohort A", count: 3, egp: 37500 },
      { id: expect.any(Number), name: "Demo Cohort B", count: 2, egp: 22500 },
    ]);
    expect(revenue.bySource.map((r) => [r.label, r.egp]).sort()).toEqual([["Instagram", 22500], ["Masterclass", 22500], ["Referral", 15000]]);
    const [{ sum }] = await client`select sum(amount_egp)::int as sum from enrolments`;
    expect(revenue.totalEgp).toBe(sum);
    for (const g of [revenue.byTier, revenue.byCohort, revenue.bySource]) expect(g.reduce((t, r) => t + r.egp, 0)).toBe(60000);
  });

  it("leaks: top lost reasons and top objection tags (ties broken alphabetically)", async () => {
    const { leaks } = await M();
    expect(leaks.lostReasons).toEqual([
      { label: "No response", count: 2 },
      { label: "Price", count: 2 },
      { label: "Not a fit", count: 1 },
      { label: "Timing", count: 1 },
    ]);
    expect(leaks.objections).toEqual([
      { label: "Price", count: 3 },
      { label: "Time", count: 2 },
      { label: "Trust", count: 2 },
    ]);
  });

  it("source quality: leads, enrolments and conversion per source and campaign (small samples as counts)", async () => {
    const { sources, campaigns } = await M();
    const by = Object.fromEntries(sources.map((x) => [x.label, x]));
    expect([by["Instagram"].leads, by["Instagram"].enrolled, fmtRate(by["Instagram"].rate)]).toEqual([8, 2, "25.0%"]);
    expect([by["Facebook group"].leads, by["Facebook group"].enrolled, fmtRate(by["Facebook group"].rate)]).toEqual([5, 0, "0.0%"]);
    expect([by["Masterclass"].leads, by["Masterclass"].enrolled, fmtRate(by["Masterclass"].rate)]).toEqual([4, 2, "2 of 4"]);
    expect([by["Referral"].leads, by["Referral"].enrolled, fmtRate(by["Referral"].rate)]).toEqual([3, 1, "1 of 3"]);
    expect(campaigns).toHaveLength(1);
    expect([campaigns[0].label, campaigns[0].leads, campaigns[0].enrolled, fmtRate(campaigns[0].rate)]).toEqual(["Masterclass Sep", 4, 2, "2 of 4"]);
  });

  it("weekly trend: new leads, consults and enrolments per Cairo week (Monday start)", async () => {
    const { weekly } = await M();
    expect(weekly).toEqual([
      { week: "2026-08-03", leads: 5, consults: 2, enrolments: 0 },
      { week: "2026-08-10", leads: 5, consults: 3, enrolments: 2 },
      { week: "2026-08-17", leads: 5, consults: 3, enrolments: 2 },
      { week: "2026-08-24", leads: 5, consults: 1, enrolments: 0 },
      { week: "2026-08-31", leads: 0, consults: 1, enrolments: 1 },
      { week: "2026-09-07", leads: 0, consults: 1, enrolments: 0 },
    ]);
  });

  it("filter by owner (Badr owns leads 13-20)", async () => {
    const m = await M({ owner: (await client`select id from users where name = 'Badr'`)[0].id });
    expect(m.totalLeads).toBe(8);
    expect(counts(m)).toEqual({ new: 8, contacted: 6, replied: 3, consult_booked: 2, consult_held: 2, offer_sent: 1, enrolled: 0 });
    expect(m.speed.medianMinutes).toBe(17.5); // 3,4,5,30,60,90
    expect(m.speed.within5).toMatchObject({ num: 3, den: 8 });
    expect(m.sideStages.map((x) => x.count)).toEqual([1, 1]);
    expect(m.revenue.totalEgp).toBe(0);
    expect(m.cycle).toEqual({ enrolled: 0, medianDays: null });
    expect(fmtRate(m.consults.showUp)).toBe("2 of 2");
  });

  it("filter by segment, source, campaign and cohort", async () => {
    const dentist = await M({ segment: "dentist" });
    expect(dentist.totalLeads).toBe(3);
    expect(dentist.revenue.totalEgp).toBe(37500);
    expect(dentist.cycle.medianDays).toBe(10);

    const fb = await M({ source: (await client`select id from sources where label = 'Facebook group'`)[0].id });
    expect(counts(fb)).toEqual({ new: 5, contacted: 5, replied: 3, consult_booked: 2, consult_held: 1, offer_sent: 0, enrolled: 0 });
    expect(fb.funnel.map((f) => (f.conversion ? fmtRate(f.conversion) : "-"))).toEqual(["-", "100.0%", "60.0%", "2 of 3", "1 of 2", "0 of 1", "–"]);

    const camp = await M({ campaign: (await client`select id from campaigns limit 1`)[0].id });
    expect(camp.totalLeads).toBe(4);
    expect(counts(camp).enrolled).toBe(2);

    const cohortA = await M({ cohort: (await client`select id from cohorts where name = 'Demo Cohort A'`)[0].id });
    expect(cohortA.totalLeads).toBe(3);
    expect(counts(cohortA)).toEqual({ new: 3, contacted: 3, replied: 3, consult_booked: 3, consult_held: 3, offer_sent: 3, enrolled: 3 });
    expect(cohortA.revenue.byCohort.map((c) => c.name)).toEqual(["Demo Cohort A"]);
  });

  it("filter by date range: inclusive of the end day, in Cairo dates", async () => {
    const week2 = await M({ from: "2026-08-10", to: "2026-08-16" });
    expect(week2.totalLeads).toBe(5); // leads 4,5,7,10,11
    expect((await M({ from: "2026-08-10", to: "2026-08-10" })).totalLeads).toBe(1);
    expect((await M({ from: "2026-08-11" })).totalLeads).toBe(14); // 20 minus leads 1,2,3,4,6,9 (created before 11 Aug)
    expect((await M({ to: "2026-08-02" })).totalLeads).toBe(0);
  });

  it("an empty selection returns zeros, not errors", async () => {
    const m = await M({ to: "2026-08-02" });
    expect(m).toMatchObject({ totalLeads: 0, revenue: { totalEgp: 0, enrolments: 0 } });
    expect(m.speed.medianMinutes).toBeNull();
    expect(fmtRate(m.speed.within5)).toBe("–");
    expect(m.weekly).toEqual([]);
  });

  it("deleted leads are excluded from every metric", async () => {
    await client`update leads set deleted_at = now() where full_name = 'Demo Lead 20'`;
    const m = await M();
    expect(m.totalLeads).toBe(19);
    expect(counts(m).new).toBe(19);
    await client`update leads set deleted_at = null where full_name = 'Demo Lead 20'`;
  });
});

d("consults awaiting a result", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  afterAll(() => client.end());

  it("a consult whose time has passed with no result is counted as awaiting, so the buckets add up to booked", async () => {
    // reuses the dataset from the previous block: lead 12's consult is on 12 Sep 2026; look at it from 20 Sep
    const m = await getMetrics(db, {}, new Date("2026-09-20T12:00:00Z"));
    expect(m.consults).toMatchObject({ booked: 11, held: 9, noShow: 1, pending: 0, awaiting: 1 });
    expect(m.consults.held + m.consults.noShow + m.consults.pending + m.consults.awaiting).toBe(m.consults.booked);
  });
});
