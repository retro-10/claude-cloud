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

    const sales = (await alerts(db, "sales", now)).map((a) => a.key);
    expect(sales).not.toContain("instalments");
    expect(sales).toContain("past_red");
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
});
