import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads, programmeSessions, proofItems, teamMembers } from "@/db/schema";
import { audit } from "./audit";

// Programme data that lives in the camp's Notion (Candidates, Sessions, Proof & Testimonial Bank) and is
// synced both ways. Option lists are Notion's own labels, stored as they are so the sync round-trips exactly.

export const CONSENT_SCOPES = ["Voice", "Video", "Patient case", "Name"] as const;
export const SESSION_TYPES = ["Production Partner 1:1", "Freelance Ready group Q&A"] as const;
export const WEEKDAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export const PROOF_TYPES = ["Voice note", "Screenshot", "QC result", "Leaderboard shot", "Video", "Message"] as const;
export const PROOF_CONSENT = ["Not asked", "Asked", "Granted", "Declined"] as const;
export const USABLE_IN = ["Reel", "Carousel", "Story", "YouTube", "Text"] as const;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
const oneOf = <T extends readonly string[]>(list: T, v: string | null | undefined) => (v && (list as readonly string[]).includes(v) ? v : null);
const someOf = <T extends readonly string[]>(list: T, vs: string[]) => [...new Set(vs.filter((v) => (list as readonly string[]).includes(v)))].sort();
const isUrl = (v: string | null) => !v || /^https?:\/\/\S+$/i.test(v);

// ---------------- the candidate's programme fields ----------------

export type ProgrammeInput = { contentConsent: boolean; contentConsentScope: string[]; qcScore: number | null; leaderboardRank: number | null };

export async function updateProgramme(db: Db, enrolmentId: number, p: ProgrammeInput, userId: number | null): Promise<Result> {
  if (p.qcScore !== null && (!Number.isFinite(p.qcScore) || p.qcScore < 0 || p.qcScore > 1000)) return { ok: false, error: "QC score must be a number" };
  if (p.leaderboardRank !== null && (!Number.isInteger(p.leaderboardRank) || p.leaderboardRank < 1)) return { ok: false, error: "Rank must be 1 or more" };
  const rows = await db
    .update(enrolments)
    .set({
      contentConsent: p.contentConsent,
      contentConsentScope: p.contentConsent ? someOf(CONSENT_SCOPES, p.contentConsentScope) : [],
      qcScore: p.qcScore,
      leaderboardRank: p.leaderboardRank,
      updatedAt: new Date(),
    })
    .where(eq(enrolments.id, enrolmentId))
    .returning({ id: enrolments.id });
  if (!rows.length) return { ok: false, error: "Candidate not found" };
  await audit(db, { userId, entity: "enrolment", entityId: enrolmentId, action: "programme_update" });
  return { ok: true };
}

// ---------------- sessions ----------------

export type SessionInput = {
  name: string;
  enrolmentId: number | null;
  type?: string | null;
  dayOfWeek?: string | null;
  time?: string | null;
  recorded?: boolean;
  driveLink?: string | null;
  notes?: string | null;
};

export async function saveSession(db: Db, id: number | null, s: SessionInput, userId: number | null): Promise<Result<{ id: number }>> {
  if (!s.name.trim() || s.name.length > 200) return { ok: false, error: "Give the session a short name" };
  const driveLink = clean(s.driveLink);
  if (!isUrl(driveLink)) return { ok: false, error: "The recording link must start with https://" };
  const values = {
    name: s.name.trim(),
    enrolmentId: s.enrolmentId,
    type: oneOf(SESSION_TYPES, s.type),
    dayOfWeek: oneOf(WEEKDAYS, s.dayOfWeek),
    time: clean(s.time)?.slice(0, 40) ?? null,
    recorded: !!s.recorded,
    driveLink,
    notes: clean(s.notes),
    updatedAt: new Date(),
  };
  let rowId = id;
  if (id) {
    const r = await db.update(programmeSessions).set(values).where(and(eq(programmeSessions.id, id), isNull(programmeSessions.deletedAt))).returning({ id: programmeSessions.id });
    if (!r.length) return { ok: false, error: "Session not found" };
  } else {
    const [r] = await db.insert(programmeSessions).values(values).returning({ id: programmeSessions.id });
    rowId = r.id;
  }
  await audit(db, { userId, entity: "session", entityId: rowId!, action: id ? "update" : "create" });
  return { ok: true, id: rowId! };
}

export async function deleteSession(db: Db, id: number, userId: number | null) {
  await db.update(programmeSessions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(programmeSessions.id, id));
  await audit(db, { userId, entity: "session", entityId: id, action: "delete" });
}

export async function listSessions(db: Db, enrolmentIds: number[]) {
  if (!enrolmentIds.length) return [];
  return db
    .select()
    .from(programmeSessions)
    .where(and(inArray(programmeSessions.enrolmentId, enrolmentIds), isNull(programmeSessions.deletedAt)))
    .orderBy(asc(programmeSessions.id));
}

// ---------------- proof & testimonials ----------------

export type ProofInput = {
  name: string;
  enrolmentId: number | null;
  type?: string | null;
  consentStatus?: string | null;
  usableIn?: string[];
  fileOrLink?: string | null;
  quote?: string | null;
};

export async function saveProof(db: Db, id: number | null, p: ProofInput, userId: number | null): Promise<Result<{ id: number }>> {
  if (!p.name.trim() || p.name.length > 200) return { ok: false, error: "Give the item a short name" };
  const fileOrLink = clean(p.fileOrLink);
  if (!isUrl(fileOrLink)) return { ok: false, error: "The file or link must start with https://" };
  const values = {
    name: p.name.trim(),
    enrolmentId: p.enrolmentId,
    type: oneOf(PROOF_TYPES, p.type),
    consentStatus: oneOf(PROOF_CONSENT, p.consentStatus) ?? "Not asked",
    usableIn: someOf(USABLE_IN, p.usableIn ?? []),
    fileOrLink,
    quote: clean(p.quote),
    updatedAt: new Date(),
  };
  let rowId = id;
  if (id) {
    const r = await db.update(proofItems).set(values).where(and(eq(proofItems.id, id), isNull(proofItems.deletedAt))).returning({ id: proofItems.id });
    if (!r.length) return { ok: false, error: "Item not found" };
  } else {
    const [r] = await db.insert(proofItems).values(values).returning({ id: proofItems.id });
    rowId = r.id;
  }
  // the quote itself is never put in the audit log
  await audit(db, { userId, entity: "proof", entityId: rowId!, action: id ? "update" : "create", diff: { consentStatus: values.consentStatus } });
  return { ok: true, id: rowId! };
}

export async function deleteProof(db: Db, id: number, userId: number | null) {
  await db.update(proofItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(proofItems.id, id));
  await audit(db, { userId, entity: "proof", entityId: id, action: "delete" });
}

export async function listProof(db: Db, f: { enrolmentIds?: number[]; consent?: string; type?: string; cohortId?: number } = {}) {
  const where: (SQL | undefined)[] = [isNull(proofItems.deletedAt)];
  if (f.enrolmentIds) where.push(f.enrolmentIds.length ? inArray(proofItems.enrolmentId, f.enrolmentIds) : sql`false`);
  if (f.consent && (PROOF_CONSENT as readonly string[]).includes(f.consent)) where.push(eq(proofItems.consentStatus, f.consent));
  if (f.type && (PROOF_TYPES as readonly string[]).includes(f.type)) where.push(eq(proofItems.type, f.type));
  if (f.cohortId) where.push(eq(enrolments.cohortId, f.cohortId));
  return db
    .select({ p: proofItems, candidate: leads.fullName, leadId: leads.id, cohort: cohorts.name, contentConsent: enrolments.contentConsent })
    .from(proofItems)
    .leftJoin(enrolments, eq(enrolments.id, proofItems.enrolmentId))
    .leftJoin(leads, eq(leads.id, enrolments.leadId))
    .leftJoin(cohorts, eq(cohorts.id, enrolments.cohortId))
    .where(and(...where))
    .orderBy(desc(proofItems.id))
    .limit(500);
}

/** Proof is safe to publish only when the item's consent is Granted (and the candidate's consent is on file). */
export const publishable = (p: { consentStatus: string | null }, candidateConsent: boolean | null) => p.consentStatus === "Granted" && candidateConsent !== false;

// ---------------- team (read-only mirror of Notion) ----------------

export const listTeam = (db: Db) =>
  db.select({ id: teamMembers.id, name: teamMembers.name, role: teamMembers.role, status: teamMembers.status }).from(teamMembers).orderBy(asc(teamMembers.name));
