import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { attendanceSummary, copySchedule, listClasses, markAttendance, roster, saveClass } from "@/lib/classes";
import { createCohort } from "@/lib/cohorts";
import { createLead } from "@/lib/leads";
import { cairoLocalToDate, toCairoLocalInput } from "@/lib/time";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("classes and attendance", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, b1: number, b2: number;
  const e: Record<string, number> = {};
  const classIds: number[] = [];

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
    b1 = (await createCohort(db, { name: "Batch 1", seatCap: 40 }, userId)).id;
    b2 = (await createCohort(db, { name: "Batch 2", seatCap: 40 }, userId)).id;
    for (const [k, phone, cohort, status] of [["amr", "01088800001", b1, "active"], ["dina", "01088800002", b1, "active"], ["gone", "01088800003", b1, "dropped"], ["other", "01088800004", b2, "active"]] as const) {
      const l = await createLead(db, { fullName: `${k} student`, phone }, userId);
      if (!l.ok) throw new Error("setup");
      const [row] = await db.insert(s.enrolments).values({ leadId: l.lead.id, cohortId: cohort, tier: "foundation", amountEgp: 7500, status }).returning();
      e[k] = row.id;
    }
  });
  afterAll(() => client.end());

  it("adds classes; checks title, time, length and links", async () => {
    for (const [title, at] of [["Intro", "2026-10-03T18:00"], ["Crowns 1", "2026-10-05T18:00"], ["Crowns 2", "2026-10-10T11:30"]] as const) {
      const r = await saveClass(db, null, { cohortId: b1, title, module: "Module 1", startsAt: cairoLocalToDate(at)!, instructorId: userId, materialsUrl: "https://drive.example/x" }, userId);
      if (!r.ok) throw new Error(r.error);
      classIds.push(r.id);
    }
    expect(await saveClass(db, null, { cohortId: b1, title: " ", startsAt: new Date() }, userId)).toMatchObject({ ok: false });
    expect(await saveClass(db, null, { cohortId: b1, title: "x", startsAt: new Date(), durationMin: 5 }, userId)).toMatchObject({ ok: false });
    expect(await saveClass(db, null, { cohortId: b1, title: "x", startsAt: new Date(), recordingUrl: "javascript:x" }, userId)).toEqual({ ok: false, error: "Links must start with https://" });
    expect((await listClasses(db, { cohortId: b1 })).map((c) => c.title)).toEqual(["Intro", "Crowns 1", "Crowns 2"]);
  });

  it("copies a schedule to another batch: same gaps and times of day, from the chosen first day", async () => {
    expect(await copySchedule(db, b1, b2, "2027-01-02", userId)).toEqual({ ok: true, copied: 3 });
    const copied = await listClasses(db, { cohortId: b2 });
    expect(copied.map((c) => toCairoLocalInput(c.startsAt))).toEqual(["2027-01-02T18:00", "2027-01-04T18:00", "2027-01-09T11:30"]); // winter time, same Cairo clock
    expect(copied[0].recordingUrl).toBeNull();
    expect(await copySchedule(db, b1, b1, "2027-01-02", userId)).toMatchObject({ ok: false });
  });

  it("the roster is the batch's students without the dropped; marks only count for them", async () => {
    expect((await roster(db, classIds[0])).map((r) => r.enrolmentId).sort()).toEqual([e.amr, e.dina].sort());
    const r = await markAttendance(db, classIds[0], [{ enrolmentId: e.amr, status: "present" }, { enrolmentId: e.dina, status: "absent" }, { enrolmentId: e.other, status: "present" }], userId);
    expect(r).toMatchObject({ ok: true, marked: 2, checkIns: 0 });
  });

  it("a second unexcused absence makes one check-in task; an excused one does not count", async () => {
    await markAttendance(db, classIds[1], [{ enrolmentId: e.amr, status: "excused" }, { enrolmentId: e.dina, status: "absent" }], userId);
    const t = await db.select().from(s.tasks).where(eq(s.tasks.cohortId, b1));
    expect(t).toMatchObject([{ title: "Check in with dina student (missed classes)", priority: "high" }]);
    const again = await markAttendance(db, classIds[2], [{ enrolmentId: e.dina, status: "absent" }, { enrolmentId: e.amr, status: "late" }], userId);
    expect(again.checkIns).toBe(0); // once per student and batch
    const sum = await attendanceSummary(db, b1);
    expect(sum.get(e.amr)).toMatchObject({ present: 1, late: 1, excused: 1, rate: 1 });
    expect(sum.get(e.dina)).toMatchObject({ absent: 3, rate: 0 });
    // clearing a mark removes it
    await markAttendance(db, classIds[2], [{ enrolmentId: e.dina, status: null }], userId);
    expect((await attendanceSummary(db, b1)).get(e.dina)!.absent).toBe(2);
  });
});
