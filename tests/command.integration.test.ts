import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { alerts, getReview, isWeek, pulse, saveReview, weekStartOf } from "@/lib/command";
import { createCohort } from "@/lib/cohorts";
import { createLead } from "@/lib/leads";
import { createTask, setTaskState } from "@/lib/tasks";
import { saveTarget } from "@/lib/targets";
import { plannerDefaults } from "@/lib/tools-data";
import { withoutRelease11Rules } from "./base-rules";

describe("weeks start on Monday, Cairo calendar", () => {
  it("finds the Monday and accepts only Mondays", () => {
    expect(weekStartOf(new Date("2026-10-07T10:00:00Z"))).toBe("2026-10-05"); // Wednesday
    expect(weekStartOf(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05"); // Monday 00:30 in Cairo, Sunday in UTC
    expect(isWeek("2026-10-05")).toBe(true);
    expect(isWeek("2026-10-06")).toBe(false);
    expect(isWeek("nonsense")).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("Command centre", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const now = new Date("2026-11-15T10:00:00Z");
  let userId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
    // 3 leads in the last 7 days (one waiting 2 hours, never contacted), 1 lead the week before
    for (let i = 0; i < 4; i++) {
      const l = await createLead(db, { fullName: `P${i}`, phone: `0102222000${i}` }, userId);
      if (!l.ok) throw new Error("setup");
    }
    await client`update leads set created_at = ${new Date(now.getTime() - 2 * 3600_000).toISOString()}, first_contact_at = null`;
    await client`update leads set created_at = ${new Date(now.getTime() - 10 * 86_400_000).toISOString()} where full_name = 'P3'`;
    await client`update leads set first_contact_at = created_at where full_name in ('P1', 'P2')`;
    // an overdue instalment, and a task overdue and one done this week
    await db.insert(s.ledgerEntries).values({ entry: "Instalment", amountEgp: 5000, section: "income", category: "Candidate payment", status: "expected", date: new Date("2026-11-01T10:00:00Z") });
    const t1 = await createTask(db, { title: "Overdue", dueAt: new Date("2026-11-10T07:00:00Z") }, userId);
    const t2 = await createTask(db, { title: "Finished" }, userId);
    if (!t1.ok || !t2.ok) throw new Error("setup");
    await setTaskState(db, t2.id, "done", userId);
    await client`update tasks set done_at = ${new Date(now.getTime() - 86_400_000).toISOString()} where id = ${t2.id}`;
    // a batch closing in 5 days with seats left, and a target that is behind
    await createCohort(db, { name: "Batch 9", seatCap: 30, status: "live", enrolmentCloseAt: new Date(now.getTime() + 5 * 86_400_000) }, userId);
    await saveTarget(db, "enrolments", "2026-Q4", 40, userId);
  });
  afterAll(() => client.end());

  it("pulse compares the last 7 days with the 7 before", async () => {
    const p = await pulse(db, now);
    expect(p.leads).toEqual({ now: 3, before: 1 });
    expect(p.tasks_done).toEqual({ now: 1, before: 0 });
  });

  it("alerts list what needs a person, urgent first; money only for owners and finance", async () => {
    const owner = await alerts(db, "owner", now);
    const keys = owner.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["past_red", "instalments", "tasks_overdue", "target_enrolments"]));
    expect(keys.some((k) => k.startsWith("batch_"))).toBe(true);
    expect(owner.find((a) => a.key === "past_red")).toMatchObject({ count: 2, severity: "danger", href: "/leads?view=uncontacted" }); // P0 and the older P3;
    expect(owner.find((a) => a.key === "instalments")!.detail).toContain("5,000 EGP");
    // severity order: every danger before every warn before every info
    const rank = { danger: 0, warn: 1, info: 2 };
    expect(owner.map((a) => rank[a.severity])).toEqual([...owner.map((a) => rank[a.severity])].sort());

    // content planned for earlier and not posted shows for everyone; rewards to decide only with money
    await db.insert(s.contentItems).values({ title: "Late reel", status: "editing", publishAt: new Date(now.getTime() - 3600_000) });
    const [a, b] = await db.select({ id: s.leads.id }).from(s.leads).limit(2);
    await db.insert(s.referralRewards).values({ referrerId: a.id, referredLeadId: b.id });
    const again = (await alerts(db, "owner", now)).map((x) => x.key);
    expect(again).toEqual(expect.arrayContaining(["content_late", "rewards"]));
    const sales = (await alerts(db, "sales", now)).map((a) => a.key);
    expect(sales).toContain("content_late");
    expect(sales).not.toContain("rewards");
    // teaching: work to review, and a class held this week with no attendance taken
    const [batch] = await db.select().from(s.cohorts).limit(1);
    await db.insert(s.batchClasses).values({ cohortId: batch.id, title: "Held", startsAt: new Date(now.getTime() - 86_400_000) });
    const [asg] = await db.insert(s.assignments).values({ cohortId: batch.id, title: "Case", rubric: [{ name: "Fit", max: 10 }] }).returning();
    const [someone] = await db.select().from(s.leads).limit(1);
    const [en] = await db.insert(s.enrolments).values({ leadId: someone.id, cohortId: batch.id, tier: "foundation", amountEgp: 1 }).returning();
    await db.insert(s.submissions).values({ assignmentId: asg.id, enrolmentId: en.id, link: "https://x.example" });
    const teach = await alerts(db, "instructor", now);
    expect(teach.find((a) => a.key === "to_review")).toMatchObject({ count: 1 });
    expect(teach.find((a) => a.key === "unmarked")).toMatchObject({ count: 1 });
    // leave nothing behind for the tests after this one
    await client`delete from submissions where enrolment_id = ${en.id}`;
    await client`delete from enrolments where id = ${en.id}`;
    await client`delete from assignments where id = ${asg.id}`;
    await client`delete from batch_classes where cohort_id = ${batch.id}`;
    expect(sales).not.toContain("instalments");
    expect(sales).toContain("past_red");
  });

  it("Phase 4 alerts: late and waiting cases, overdue invoices, decisions, checklists, jobs nobody does, over budget — each for who can act", async () => {
    const [client_] = await db.insert(s.productionClients).values({ name: "Clinic" }).returning();
    const [type] = await db.insert(s.caseTypes).values({ name: "Crown", unitPriceEgp: 900 }).returning();
    const base = { clientId: client_.id, caseTypeId: type.id, priceEgp: 900 };
    await db
      .insert(s.productionCases)
      .values([
        { ...base, status: "designing" as const, dueAt: new Date(now.getTime() - 3600_000) }, // late
        { ...base, status: "qc" as const, dueAt: new Date(now.getTime() + 86_400_000) },
        { ...base, status: "received" as const, dueAt: new Date(now.getTime() + 86_400_000) },
        { ...base, status: "invoiced" as const, dueAt: now, deliveredAt: new Date(now.getTime() - 2 * 86_400_000) },
      ]);
    const [inv] = await db.insert(s.invoices).values({ number: "INV-2026-0001", clientId: client_.id, clientName: "Clinic", dueAt: new Date(now.getTime() - 86_400_000), totalEgp: 900, lines: [] }).returning();
    await db.insert(s.ledgerEntries).values({ entry: "INV-2026-0001", amountEgp: 900, date: inv.dueAt, section: "income", category: "OrlaDent client work", status: "expected", invoiceId: inv.id });
    await db.insert(s.decisions).values({ title: "Decide", dueAt: new Date(now.getTime() - 86_400_000) });
    await db.insert(s.responsibilities).values({ area: "QC every case" });
    await db.insert(s.budgets).values({ month: "2026-11", section: "variable_costs", category: "Ads & promotion", amountEgp: 100 });
    await db.insert(s.ledgerEntries).values({ entry: "Ads", amountEgp: 500, date: now, section: "variable_costs", category: "Ads & promotion", status: "paid" });
    const owner = (await alerts(db, "owner", now)).map((a) => a.key);
    expect(owner).toEqual(expect.arrayContaining(["cases_late", "cases_qc", "cases_unassigned", "invoices", "decisions_overdue", "gaps", "budget"]));
    const sales = (await alerts(db, "sales", now)).map((a) => a.key);
    expect(sales).toContain("decisions_overdue");
    for (const k of ["cases_late", "cases_qc", "invoices", "gaps", "budget"]) expect(sales).not.toContain(k);
    const finance = (await alerts(db, "finance", now)).map((a) => a.key);
    expect(finance).toEqual(expect.arrayContaining(["cases_late", "invoices", "budget"]));
    expect(finance).not.toContain("cases_qc");
    // delivered cases count in the pulse
    expect((await pulse(db, now)).cases_delivered.now).toBe(1);
    await client.unsafe("delete from ledger_entries where invoice_id is not null or category = 'Ads & promotion'; delete from production_cases; delete from invoices; delete from production_clients; delete from case_types; delete from decisions; delete from responsibilities; delete from budgets");
  });

  it("a weekly review saves that week's numbers with it, and saving again updates it", async () => {
    const week = weekStartOf(now); // 2026-11-09
    expect(await saveReview(db, "2026-11-10", { wins: "x" }, userId)).toEqual({ ok: false, error: "Pick the Monday of a week" });
    expect(await saveReview(db, week, { wins: "Batch 9 half full", decisions: "  " }, userId)).toEqual({ ok: true });
    let r = await getReview(db, week);
    expect(r).toMatchObject({ wins: "Batch 9 half full", decisions: null });
    expect(r!.snapshot).toMatchObject({ leads: 3, tasks_done: 1 });
    await saveReview(db, week, { wins: "Batch 9 half full", misses: "Slow replies on Friday" }, userId);
    r = await getReview(db, week);
    expect(r).toMatchObject({ misses: "Slow replies on Friday" });
    expect(await db.select().from(s.weeklyReviews)).toHaveLength(1);
  });

  it("the batch planner starts from placeholders when history is thin, and lists open batches with seats taken", async () => {
    const d = await plannerDefaults(db, now);
    expect(d).toMatchObject({ fromData: false, leadToConsult: 0.2, consultToEnrol: 0.4, avgPriceEgp: 11250 });
    expect(d.batches).toMatchObject([{ name: "Batch 9", seatCap: 30, enrolled: 0 }]);
  });
});
