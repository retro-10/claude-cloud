import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { listCandidates } from "@/lib/finance";
import { deleteProof, listProof, listSessions, publishable, saveProof, saveSession, updateProgramme } from "@/lib/programme";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("programme data: content consent, QC, sessions, proof", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let enrolmentId: number, leadId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    const [c] = await db.insert(s.cohorts).values({ name: "B1", seatCap: 40 }).returning();
    const [l] = await db.insert(s.leads).values({ fullName: "Mona", stage: "enrolled" }).returning();
    leadId = l.id;
    const [e] = await db.insert(s.enrolments).values({ leadId, cohortId: c.id, tier: "foundation", amountEgp: 7500 }).returning();
    enrolmentId = e.id;
  });
  afterAll(() => client.end());

  it("programme fields are validated; consent scope keeps only known options and clears without consent", async () => {
    expect(await updateProgramme(db, enrolmentId, { contentConsent: true, contentConsentScope: [], qcScore: null, leaderboardRank: 0 }, null)).toMatchObject({ ok: false });
    expect(await updateProgramme(db, 9999, { contentConsent: false, contentConsentScope: [], qcScore: null, leaderboardRank: null }, null)).toMatchObject({ ok: false });
    expect(await updateProgramme(db, enrolmentId, { contentConsent: true, contentConsentScope: ["Video", "Voice", "Hack"], qcScore: 92.5, leaderboardRank: 2 }, null)).toEqual({ ok: true });
    let [c] = await listCandidates(db, { leadId });
    expect(c).toMatchObject({ contentConsent: true, contentConsentScope: ["Video", "Voice"], qcScore: 92.5, leaderboardRank: 2 });
    await updateProgramme(db, enrolmentId, { contentConsent: false, contentConsentScope: ["Video"], qcScore: 92.5, leaderboardRank: 2 }, null);
    [c] = await listCandidates(db, { leadId });
    expect(c.contentConsentScope).toEqual([]);
  });

  it("sessions: named, links must be web links, options must be Notion's", async () => {
    expect(await saveSession(db, null, { name: " ", enrolmentId }, null)).toMatchObject({ ok: false });
    expect(await saveSession(db, null, { name: "1:1", enrolmentId, driveLink: "javascript:alert(1)" }, null)).toMatchObject({ ok: false });
    const r = await saveSession(db, null, { name: "1:1", enrolmentId, type: "Made up", dayOfWeek: "Monday", recorded: true }, null);
    expect(r.ok).toBe(true);
    expect(await listSessions(db, [enrolmentId])).toMatchObject([{ name: "1:1", type: null, dayOfWeek: "Monday", recorded: true }]);
  });

  it("proof: consent defaults to Not asked; only Granted with the candidate's consent is ready to use; the quote stays out of the audit log", async () => {
    const r = await saveProof(db, null, { name: "Voice note", enrolmentId, quote: "It changed my week", usableIn: ["Reel", "Nope"] }, null);
    if (!r.ok) throw new Error();
    let [row] = await listProof(db, { enrolmentIds: [enrolmentId] });
    expect(row.p).toMatchObject({ consentStatus: "Not asked", usableIn: ["Reel"] });
    expect(publishable(row.p, row.contentConsent)).toBe(false);
    await saveProof(db, r.id, { name: "Voice note", enrolmentId, consentStatus: "Granted", quote: "It changed my week" }, null);
    [row] = await listProof(db, { consent: "Granted" });
    expect(publishable(row.p, true)).toBe(true);
    expect(publishable(row.p, false)).toBe(false);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, "proof"));
    expect(JSON.stringify(audits)).not.toContain("changed my week");
    await deleteProof(db, r.id, null);
    expect(await listProof(db, { enrolmentIds: [enrolmentId] })).toHaveLength(0);
  });
});
