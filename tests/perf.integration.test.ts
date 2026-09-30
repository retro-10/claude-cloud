import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { exportLeadsCsv } from "@/lib/export";
import { listLeads } from "@/lib/lead-list";
import { getMetrics } from "@/lib/metrics";
import { getBoard } from "@/lib/pipeline";
import { getToday } from "@/lib/today";
import { navCounts } from "@/lib/nav-counts";
import { searchLeads } from "@/lib/search";
import { runScheduledRules } from "@/lib/workflows";
import { findDuplicates } from "@/lib/leads";
import { listCohorts } from "@/lib/cohorts";

// Spec: "lead list and dashboard load under 1 second with 10,000 leads". This builds 10,000 leads with
// realistic history (about 30,000 stage events, 20,000 activities, follow-ups, consults, enrolments) and
// times the queries behind each screen. The limit is the spec's 1000 ms, applied to the database work;
// page rendering on top of it is measured separately in the browser (see DECISIONS.md, Phase 8).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const LIMIT_MS = 1000;
const N = 10_000;

d(`performance with ${N} leads`, () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const timings: Record<string, number> = {};

  async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await fn(); // warm-up: plan cache and connection, as in real use after the first page view
    const t0 = performance.now();
    const out = await fn();
    timings[name] = Math.round(performance.now() - t0);
    return out;
  }

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await client.unsafe(`
      insert into cohorts (name, seat_cap) select 'Perf cohort ' || g, 5000 from generate_series(1, 3) g;
      insert into campaigns (label, source_id) select 'Perf campaign ' || g, g from generate_series(1, 3) g;

      insert into leads (full_name, phone_whatsapp, email, segment, source_id, campaign_id, tier_interest, stage, owner_id,
                         lost_reason_id, notes, created_at, updated_at, first_contact_at, closed_at)
      select 'Perf Lead ' || g,
             '+2010' || lpad(g::text, 8, '0'),
             'perf' || g || '@example.com',
             (array['fresh_graduate','technician','dentist','other'])[1 + g % 4]::segment,
             1 + g % 7,
             case when g % 5 = 0 then 1 + g % 3 end,
             (array['foundation','freelance_ready','production_partner','unsure'])[1 + g % 4]::tier_interest,
             st,
             1 + g % 4,
             case when st = 'lost' then 1 + g % 7 end,
             'notes for perf lead ' || g || case when g % 10 = 0 then ' مهتم بالبرنامج' else '' end,
             now() - (g % 300) * interval '1 day' - (g % 1440) * interval '1 minute',
             now() - (g % 200) * interval '1 day',
             case when g % 9 <> 0 then now() - (g % 300) * interval '1 day' - (g % 1440) * interval '1 minute' + (g % 240) * interval '1 minute' end,
             case when st in ('enrolled','lost') then now() - (g % 100) * interval '1 day' end
      from (select g, (array['new','contacted','replied','consult_booked','consult_held','offer_sent','enrolled','lost','nurture'])[1 + g % 9] as st
            from generate_series(1, ${N}) g) x;

      insert into stage_events (lead_id, from_stage, to_stage, at)
        select id, null, 'new', created_at from leads;
      insert into stage_events (lead_id, from_stage, to_stage, at)
        select id, 'new', stage, created_at + interval '2 days' from leads where stage <> 'new';
      insert into stage_events (lead_id, from_stage, to_stage, at)
        select id, 'new', 'contacted', first_contact_at from leads where first_contact_at is not null and stage in ('replied','consult_booked','consult_held','offer_sent','enrolled');

      insert into activities (lead_id, type, direction, body, at)
        select id, 'whatsapp'::activity_type, 'out'::direction, 'msg', created_at + interval '1 hour' from leads
        union all select id, 'whatsapp'::activity_type, 'in'::direction, 'reply', created_at + interval '1 day' from leads where id % 3 = 0;

      insert into follow_ups (lead_id, due_at, kind, note)
        select id, now() + ((id % 40) - 20) * interval '1 day', 'whatsapp', 'perf' from leads where id % 3 = 0;

      insert into consults (lead_id, scheduled_at, held, outcome)
        select id, created_at + interval '5 days', (id % 4 <> 0), case when id % 4 = 0 then 'no_show'::consult_outcome else 'thinking'::consult_outcome end
        from leads where stage in ('consult_booked','consult_held','offer_sent','enrolled','lost');
      insert into consult_objections (consult_id, objection_id)
        select c.id, 1 + c.id % 6 from consults c where c.id % 2 = 0;

      insert into enrolments (lead_id, cohort_id, tier, amount_egp, created_at)
        select id, 1 + id % 3, (array['foundation','freelance_ready','production_partner'])[1 + id % 3]::tier,
               (array[7500, 15000, 30000])[1 + id % 3], created_at + interval '10 days'
        from leads where stage = 'enrolled';
      -- half of them paid: one received ledger row each
      insert into ledger_entries (entry, amount_egp, date, section, category, status, enrolment_id, cohort_id)
        select 'perf payment', amount_egp, now(), 'income', 'Candidate payment', 'received', id, cohort_id from enrolments where id % 2 = 0;
      analyze;
    `);
  }, 120_000);
  afterAll(async () => {
    console.info("timings (ms):", JSON.stringify(timings)); // eslint-disable-line no-console
    await client.end();
  });

  it("has the volume it claims", async () => {
    const [{ leads, events, acts }] = await client`select (select count(*)::int from leads) as leads, (select count(*)::int from stage_events) as events, (select count(*)::int from activities) as acts`;
    expect(leads).toBe(N);
    expect(events).toBeGreaterThan(20_000);
    expect(acts).toBeGreaterThan(13_000);
  });

  it("has the indexes the spec asks for (stage, owner_id, created_at, phone, follow-up due_at)", async () => {
    const rows = await client`select indexdef from pg_indexes where schemaname = 'public'`;
    const defs = rows.map((r) => String(r.indexdef));
    const has = (table: string, col: string) => defs.some((x) => x.includes(`ON public.${table} `) && x.includes(col));
    expect(has("leads", "(stage)")).toBe(true);
    expect(has("leads", "(owner_id)")).toBe(true);
    expect(has("leads", "(created_at)")).toBe(true);
    expect(has("leads", "(phone_whatsapp)")).toBe(true); // unique index
    expect(has("follow_ups", "(due_at)")).toBe(true);
    expect(has("stage_events", "(lead_id)")).toBe(true);
  });

  it(`lead list (default view, page of 50 with total count) < ${LIMIT_MS} ms`, async () => {
    const r = await time("list default", () => listLeads(db, {}));
    expect(r.total).toBe(N);
    expect(r.rows).toHaveLength(50);
    expect(timings["list default"]).toBeLessThan(LIMIT_MS);
  });

  it("lead list with search, every filter, sorting and paging < 1 s each", async () => {
    const cases: [string, Parameters<typeof listLeads>[1]][] = [
      ["search name", { q: "Perf Lead 77" }],
      ["search phone digits", { q: "10000512" }],
      ["search arabic notes", { q: "مهتم" }],
      ["search email", { q: "perf9999@" }],
      ["filter stage", { stage: "offer_sent" }],
      ["filter source+segment+tier", { source: "3", segment: "dentist", tier: "foundation" }],
      ["filter owner+dates", { owner: "2", from: "2026-01-01", to: "2026-12-31" }],
      ["filter overdue follow-up", { overdue: "1" }],
      ["sort by name page 50", { sort: "name", dir: "asc", page: "50" }],
      ["last page", { page: "200" }],
    ];
    for (const [name, f] of cases) {
      await time(name, () => listLeads(db, f));
      expect(timings[name], name).toBeLessThan(LIMIT_MS);
    }
  });

  it("dashboard, unfiltered and with every filter < 1 s", async () => {
    const all = await time("dashboard all", () => getMetrics(db, {}));
    expect(all.totalLeads).toBe(N);
    expect(all.funnel[0].count).toBe(N);
    expect(timings["dashboard all"]).toBeLessThan(LIMIT_MS);
    await time("dashboard 90 days", () => getMetrics(db, { from: "2026-07-01" }));
    await time("dashboard filtered", () => getMetrics(db, { source: 2, segment: "dentist", owner: 1, from: "2026-01-01", to: "2026-12-31" }));
    await time("dashboard cohort", () => getMetrics(db, { cohort: 1 }));
    for (const k of ["dashboard 90 days", "dashboard filtered", "dashboard cohort"]) expect(timings[k], k).toBeLessThan(LIMIT_MS);
  });

  it("the other screens: Today, pipeline board, cohorts, duplicate check, CSV export < 1 s", async () => {
    await time("today", () => getToday(db, {}));
    await time("board", () => getBoard(db));
    await time("cohorts", () => listCohorts(db));
    await time("duplicate check", () => findDuplicates(db, { phone: "0101234567", email: "nobody@example.com" }));
    const csv = await time("export all", () => exportLeadsCsv(db, {}));
    expect(csv.count).toBe(N);
    for (const k of ["today", "board", "cohorts", "duplicate check", "export all"]) expect(timings[k], k).toBeLessThan(LIMIT_MS);
  });

  it("Release 1.1: sidebar counts (every smart view), each smart view, search, scheduled rules < 1 s", async () => {
    await time("sidebar counts", () => navCounts(db));
    for (const v of ["neglected", "stale", "no_next_step", "decision_due", "no_decision_review"]) await time(`view ${v}`, () => listLeads(db, { view: v }));
    await time("palette search", () => searchLeads(db, "lead 12"));
    for (let i = 0; i < 400; i++) if (!(await runScheduledRules(db))) break; // work off the seeded backlog first
    await time("scheduled rules", () => runScheduledRules(db)); // then a normal 5-minute sweep
    for (const k of Object.keys(timings).filter((k) => k.startsWith("view ") || ["sidebar counts", "palette search", "scheduled rules"].includes(k)))
      expect(timings[k], k).toBeLessThan(LIMIT_MS);
  }, 600_000);
});
