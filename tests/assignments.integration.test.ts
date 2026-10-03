import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { listAssignments, parseRubric, recordSubmission, reviewSubmission, saveAssignment, studentAssignments, submissionsFor } from "@/lib/assignments";
import { createCohort } from "@/lib/cohorts";
import { createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

describe("rubrics", () => {
  it("read one criterion per line and refuse what does not add up", () => {
    expect(parseRubric("Margins and fit | 40\n\nOcclusion|60")).toEqual([{ name: "Margins and fit", max: 40 }, { name: "Occlusion", max: 60 }]);
    expect(parseRubric("")).toMatch(/at least one/);
    expect(parseRubric("Fit 40")).toMatch(/name \| points/);
    expect(parseRubric("Fit | 0")).toMatch(/1 to 100/);
    expect(parseRubric("Fit | 10\nfit | 20")).toMatch(/own name/);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("assignments and QC review", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, b1: number, b2: number, a1: number, a2: number;
  const e: Record<string, number> = {};
  const rubric = [{ name: "Fit", max: 60 }, { name: "Anatomy", max: 40 }];
  const sub = async (assignmentId: number, k: string) => (await submissionsFor(db, assignmentId)).find((r) => r.enrolmentId === e[k])!.sub!;
  const enrol = async (k: string) => (await db.select().from(s.enrolments).where(eq(s.enrolments.id, e[k])))[0];

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
    b1 = (await createCohort(db, { name: "B1", seatCap: 40 }, userId)).id;
    b2 = (await createCohort(db, { name: "B2", seatCap: 40 }, userId)).id;
    for (const [k, cohort, status] of [["amr", b1, "active"], ["dina", b1, "active"], ["sara", b1, "active"], ["gone", b1, "dropped"], ["other", b2, "active"]] as const) {
      const l = await createLead(db, { fullName: k, phone: `0109990000${Object.keys(e).length}` }, userId);
      if (!l.ok) throw new Error("setup");
      const [row] = await db.insert(s.enrolments).values({ leadId: l.lead.id, cohortId: cohort, tier: "foundation", amountEgp: 7500, status, ...(k === "other" ? { leaderboardRank: 4 } : {}) }).returning();
      e[k] = row.id;
    }
    a1 = ((await saveAssignment(db, null, { cohortId: b1, title: "Case 1", rubric, passPct: 70 }, userId)) as { id: number }).id;
    a2 = ((await saveAssignment(db, null, { cohortId: b1, title: "Case 2", rubric, passPct: 70 }, userId)) as { id: number }).id;
  });
  afterAll(() => client.end());

  it("a submission needs a file or link, and the student must be in the batch", async () => {
    expect(await recordSubmission(db, a1, e.amr, {}, { userId })).toEqual({ ok: false, error: "Attach the file or paste a link to it" });
    expect(await recordSubmission(db, a1, e.other, { link: "https://x.example/f" }, { userId })).toMatchObject({ ok: false });
    expect(await recordSubmission(db, a1, e.gone, { link: "https://x.example/f" }, { userId })).toMatchObject({ ok: false });
    expect(await recordSubmission(db, a1, e.amr, { link: "javascript:alert(1)" }, { userId })).toMatchObject({ ok: false });
    for (const k of ["amr", "dina", "sara"]) expect(await recordSubmission(db, a1, e[k], { link: `https://drive.example/${k}` }, { userId })).toMatchObject({ ok: true, attempt: 1 });
    expect((await listAssignments(db, { cohortId: b1 }))[0]).toMatchObject({ waiting: 3, students: 3 });
  });

  it("a review scores each criterion; pass mark decides passed or rework", async () => {
    expect(await reviewSubmission(db, (await sub(a1, "amr")).id, [61, 40], null, userId)).toEqual({ ok: false, error: "Fit: 0 to 60 points" });
    expect(await reviewSubmission(db, (await sub(a1, "amr")).id, [50], null, userId)).toEqual({ ok: false, error: "Score every criterion" });
    expect(await reviewSubmission(db, (await sub(a1, "amr")).id, [54, 36], "Clean margins", userId)).toEqual({ ok: true, totalPct: 90, passed: true });
    expect(await reviewSubmission(db, (await sub(a1, "dina")).id, [54, 36], null, userId)).toEqual({ ok: true, totalPct: 90, passed: true });
    expect(await reviewSubmission(db, (await sub(a1, "sara")).id, [30, 20.5], "Contacts too heavy", userId)).toEqual({ ok: true, totalPct: 51, passed: false });
    expect(await sub(a1, "sara")).toMatchObject({ status: "rework", feedback: "Contacts too heavy" });
  });

  it("QC score is the average of reviewed work; the leaderboard ranks the batch with ties, leaving other batches alone", async () => {
    expect(await enrol("amr")).toMatchObject({ qcScore: 90, leaderboardRank: 1 });
    expect(await enrol("dina")).toMatchObject({ qcScore: 90, leaderboardRank: 1 });
    expect(await enrol("sara")).toMatchObject({ qcScore: 51, leaderboardRank: 3 });
    expect(await enrol("other")).toMatchObject({ leaderboardRank: 4 }); // typed by hand in another batch: untouched
    await recordSubmission(db, a2, e.amr, { link: "https://drive.example/amr2" }, { userId });
    await reviewSubmission(db, (await sub(a2, "amr")).id, [30, 20], null, userId);
    expect(await enrol("amr")).toMatchObject({ qcScore: 70, leaderboardRank: 2 }); // (90 + 50) / 2
    expect(await enrol("dina")).toMatchObject({ leaderboardRank: 1 });
  });

  it("rework: sending again is a new attempt waiting for review; passed work cannot be sent again", async () => {
    const r = await recordSubmission(db, a1, e.sara, { link: "https://drive.example/sara-v2", note: "Fixed contacts" }, { userId: null, student: true });
    expect(r).toMatchObject({ ok: true, attempt: 2 });
    expect(await sub(a1, "sara")).toMatchObject({ status: "submitted", totalPct: null, scores: null, note: "Fixed contacts" });
    await reviewSubmission(db, (await sub(a1, "sara")).id, [50, 34], null, userId);
    expect(await enrol("sara")).toMatchObject({ qcScore: 84 });
    expect(await recordSubmission(db, a1, e.sara, { link: "https://x.example" }, { userId })).toEqual({ ok: false, error: "This assignment is already passed" });
    expect((await studentAssignments(db, e.sara)).map((x) => [x.a.title, x.sub?.status ?? null])).toEqual([["Case 1", "passed"], ["Case 2", null]]);
  });
});
