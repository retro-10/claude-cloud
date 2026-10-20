import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { alerts } from "@/lib/command";
import { scoreRisk, studentRisks } from "@/lib/risk";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const base = { attendanceRate: 1, minAttendancePct: 75, lastTwo: [] as ("present" | "absent")[], overdueWork: 0, staleRework: 0, paymentOverdue: false };

describe("drop-risk score (pure)", () => {
  it("nothing against a student is ok", () => {
    expect(scoreRisk(base, true)).toEqual({ score: 0, level: "ok", reasons: [] });
  });
  it("adds up explainable signals", () => {
    const r = scoreRisk({ ...base, attendanceRate: 0.55, lastTwo: ["absent", "absent"], overdueWork: 3 }, true);
    expect(r.score).toBe(40 + 25 + 30);
    expect(r.level).toBe("risk");
    expect(r.reasons).toEqual(["Attendance 55% (the batch needs 75%)", "Missed the last two classes", "3 assignments past due, not handed in"]);
    expect(scoreRisk({ ...base, attendanceRate: 0.7, lastTwo: ["absent", "present"] }, true)).toMatchObject({ score: 40, level: "watch" });
    expect(scoreRisk({ ...base, staleRework: 1, attendanceRate: null }, true)).toMatchObject({ score: 10, level: "ok" });
  });
  it("an overdue instalment counts only for people who see money", () => {
    expect(scoreRisk({ ...base, paymentOverdue: true, overdueWork: 1 }, true)).toMatchObject({ score: 40, level: "watch" });
    const hidden = scoreRisk({ ...base, paymentOverdue: true, overdueWork: 1 }, false);
    expect(hidden).toMatchObject({ score: 15, level: "ok" });
    expect(hidden.reasons.join()).not.toMatch(/instalment/);
  });
});

d("drop-risk from the records", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const now = new Date("2026-10-01T10:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    const [c] = await db.insert(s.cohorts).values({ name: "Batch 7", seatCap: 30, status: "live" }).returning();
    const [ok, bad, gone] = await db.insert(s.leads).values([{ fullName: "Hana Fine" }, { fullName: "Omar Absent" }, { fullName: "Dropped Dina" }]).returning();
    const [eOk, eBad, eGone] = await db
      .insert(s.enrolments)
      .values([ok, bad, gone].map((l, i) => ({ leadId: l.id, cohortId: c.id, tier: "foundation" as const, amountEgp: 10000, status: i === 2 ? ("dropped" as const) : ("active" as const) })))
      .returning();
    const classes = await db
      .insert(s.batchClasses)
      .values([5, 4, 3].map((n) => ({ cohortId: c.id, title: `Class ${n}`, startsAt: daysAgo(n * 3) })))
      .returning();
    for (const [i, k] of classes.entries()) {
      await db.insert(s.classAttendance).values({ classId: k.id, enrolmentId: eOk.id, status: "present" });
      await db.insert(s.classAttendance).values({ classId: k.id, enrolmentId: eBad.id, status: i === 0 ? "present" : "absent" });
      await db.insert(s.classAttendance).values({ classId: k.id, enrolmentId: eGone.id, status: "absent" });
    }
    const [a] = await db.insert(s.assignments).values({ cohortId: c.id, title: "Crown 1", dueAt: daysAgo(2), rubric: [] }).returning();
    await db.insert(s.submissions).values({ assignmentId: a.id, enrolmentId: eOk.id, status: "submitted" });
    await db.insert(s.ledgerEntries).values({ entry: "Instalment 2", amountEgp: 5000, section: "income", category: "Candidate payment", status: "expected", date: daysAgo(10), enrolmentId: eBad.id });
  });
  afterAll(() => client.end());

  it("scores active students, leaves out the fine and the dropped, and hides money from people who cannot see it", async () => {
    const rows = await studentRisks(db, { money: true, now });
    expect(rows.map((r) => r.fullName)).toEqual(["Omar Absent"]);
    // 33% attendance (+40), last two missed (+25), one assignment past due (+15), instalment overdue (+25)
    expect(rows[0]).toMatchObject({ score: 105, level: "risk", cohort: "Batch 7" });
    const noMoney = await studentRisks(db, { money: false, now });
    expect(noMoney[0].score).toBe(80);
    expect(noMoney[0].reasons.join()).not.toMatch(/instalment/);
  });

  it("raises a Command centre alert pointing at the batch", async () => {
    const list = await alerts(db, "instructor", now);
    const a = list.find((x) => x.key === "students_at_risk");
    expect(a).toMatchObject({ count: 1, title: "Students likely to drop" });
    expect(a!.detail).toContain("Omar Absent");
    expect(a!.href).toMatch(/^\/cohorts\/\d+#risk$/);
  });
});
