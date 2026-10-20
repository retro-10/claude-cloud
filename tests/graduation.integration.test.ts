import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { recordSubmission, reviewSubmission, saveAssignment } from "@/lib/assignments";
import { markAttendance, saveClass } from "@/lib/classes";
import { createCohort } from "@/lib/cohorts";
import { certificateByCode, graduate, listAlumni, newCertificateCode, revokeCertificate, saveAlumniProfile, saveRules, standings } from "@/lib/graduation";
import { createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

describe("certificate codes", () => {
  it("look like OC-XXXX-XXXX without confusable letters", () => {
    for (let i = 0; i < 50; i++) expect(newCertificateCode()).toMatch(/^OC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("graduation, certificates and alumni", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, cohortId: number, aId: number;
  const e: Record<string, number> = {};
  const lead: Record<string, number> = {};

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "g".repeat(48);
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
    cohortId = (await createCohort(db, { name: "Batch 5", seatCap: 40 }, userId)).id;
    for (const [k, i] of [["good", 1], ["absent", 2], ["unpaid", 3]] as const) {
      const l = await createLead(db, { fullName: `${k} student`, phone: `0107770000${i}` }, userId);
      if (!l.ok) throw new Error("setup");
      lead[k] = l.lead.id;
      const [row] = await db.insert(s.enrolments).values({ leadId: l.lead.id, cohortId, tier: "freelance_ready", amountEgp: 15000 }).returning();
      e[k] = row.id;
    }
    // classes: good and unpaid come to both, absent misses both
    for (const day of ["2026-10-03", "2026-10-05"]) {
      const c = await saveClass(db, null, { cohortId, title: day, startsAt: new Date(`${day}T15:00:00Z`) }, userId);
      if (!c.ok) throw new Error(c.error);
      await markAttendance(db, c.id, [{ enrolmentId: e.good, status: "present" }, { enrolmentId: e.unpaid, status: "late" }, { enrolmentId: e.absent, status: "absent" }], userId);
    }
    // one assignment: good and unpaid pass, absent has not sent it
    const a = await saveAssignment(db, null, { cohortId, title: "Case 1", rubric: [{ name: "Fit", max: 100 }], passPct: 70 }, userId);
    if (!a.ok) throw new Error(a.error);
    aId = a.id;
    for (const k of ["good", "unpaid"]) {
      const sub = await recordSubmission(db, aId, e[k], { link: "https://drive.example/x" }, { userId });
      if (!sub.ok) throw new Error(sub.error);
      await reviewSubmission(db, sub.id, [85], null, userId);
    }
    // payments: good paid in full, unpaid paid nothing
    await db.insert(s.ledgerEntries).values({ entry: "Paid", amountEgp: 15000, section: "income", category: "Candidate payment", status: "received", enrolmentId: e.good, cohortId });
  });
  afterAll(() => client.end());

  it("standings say what is missing for each student", async () => {
    let st = await standings(db, cohortId);
    const by = (k: string) => st.rows.find((r) => r.enrolmentId === e[k])!;
    expect(by("good")).toMatchObject({ eligible: true, attendance: 1, passed: 1, assignments: 1, missing: [] });
    expect(by("absent").missing).toEqual(["attendance 0% (needs 75%)", "1 assignment not passed"]);
    expect(by("unpaid")).toMatchObject({ eligible: true }); // payment not required by default
    await saveRules(db, cohortId, { gradMinAttendancePct: 75, gradRequireAllPassed: true, gradRequirePaid: true }, userId);
    st = await standings(db, cohortId);
    expect(st.rows.find((r) => r.enrolmentId === e.unpaid)!.missing).toEqual(["not paid in full"]);
  });

  it("graduating issues a certificate with what it said that day, an alumni profile and a referral code", async () => {
    const r = await graduate(db, e.good, userId);
    if (!r.ok) throw new Error(r.error);
    const [en] = await db.select().from(s.enrolments).where(eq(s.enrolments.id, e.good));
    expect(en.status).toBe("graduated");
    expect(await certificateByCode(db, r.code.toLowerCase())).toMatchObject({ fullName: "good student", programme: "Freelance Ready", batch: "Batch 5", override: null, revokedAt: null });
    await db.update(s.leads).set({ fullName: "Renamed Later" }).where(eq(s.leads.id, lead.good));
    expect((await certificateByCode(db, r.code))!.fullName).toBe("good student"); // the certificate keeps its wording
    expect((await db.select().from(s.leads).where(eq(s.leads.id, lead.good)))[0].referralCode).toMatch(/^[a-z]+-[a-z2-9]{4}$/);
    expect(await graduate(db, e.good, userId)).toEqual({ ok: true, code: r.code }); // again: same certificate
  });

  it("not eligible: refused for an instructor; an owner needs a reason, which the certificate keeps", async () => {
    expect(await graduate(db, e.absent, userId, { canOverride: false, override: "x" })).toEqual({ ok: false, error: "Not yet: attendance 0% (needs 75%), 1 assignment not passed, not paid in full" });
    expect(await graduate(db, e.absent, userId, { canOverride: true })).toMatchObject({ ok: false, error: expect.stringContaining("give the reason") });
    const r = await graduate(db, e.absent, userId, { canOverride: true, override: "Studied with the October batch recordings; case checked in person" });
    if (!r.ok) throw new Error(r.error);
    expect((await certificateByCode(db, r.code))!.override).toContain("recordings");
  });

  it("revoking: needs a reason, shows as revoked; graduating again issues a new code", async () => {
    const [cert] = await db.select().from(s.certificates).where(eq(s.certificates.enrolmentId, e.absent));
    expect(await revokeCertificate(db, cert.code, " ", userId)).toMatchObject({ ok: false });
    expect(await revokeCertificate(db, cert.code, "Issued by mistake", userId)).toEqual({ ok: true });
    expect((await certificateByCode(db, cert.code))!.revokedAt).not.toBeNull();
    expect(await certificateByCode(db, "OC-NOPE")).toBeNull();
    const again = await graduate(db, e.absent, userId, { canOverride: true, override: "Reviewed again" });
    if (!again.ok) throw new Error(again.error);
    expect(again.code).not.toBe(cert.code);
    expect(await certificateByCode(db, cert.code)).toBeNull(); // the old code no longer exists
  });

  it("alumni: profiles, filters by availability and skill", async () => {
    expect(await saveAlumniProfile(db, lead.good, { headline: "Crown designer", skills: ["Crowns", " crowns ", "Bridges", ""], availability: "open", portfolioUrl: "https://behance.example/good" }, userId)).toEqual({ ok: true });
    expect(await saveAlumniProfile(db, lead.absent, { skills: [], availability: "busy", portfolioUrl: "ftp://x" }, userId)).toMatchObject({ ok: false });
    await saveAlumniProfile(db, lead.absent, { skills: ["Implants"], availability: "busy" }, userId);
    const all = await listAlumni(db);
    expect(all.map((a) => a.fullName)).toEqual(["Renamed Later", "absent student"]); // open to work first
    expect(all[0]).toMatchObject({ skills: ["Crowns", "crowns", "Bridges"], tiers: ["freelance_ready"], qc: 85 });
    expect((await listAlumni(db, { availability: "open" })).map((a) => a.leadId)).toEqual([lead.good]);
    expect((await listAlumni(db, { skill: "IMPLANT" })).map((a) => a.leadId)).toEqual([lead.absent]);
  });
});
