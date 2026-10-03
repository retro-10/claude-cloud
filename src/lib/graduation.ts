import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { alumniProfiles, certificates, cohorts, enrolments, leads } from "@/db/schema";
import { audit } from "./audit";
import { attendanceSummary } from "./classes";
import { listCandidates } from "./finance";
import { TIER_LABEL } from "./pricing";
import { ensureReferralCode } from "./referrals";

type Fail = { ok: false; error: string };

export type Rules = { gradMinAttendancePct: number; gradRequireAllPassed: boolean; gradRequirePaid: boolean };

export async function saveRules(db: Db, cohortId: number, r: Rules, userId: number | null): Promise<{ ok: true } | Fail> {
  if (!Number.isInteger(r.gradMinAttendancePct) || r.gradMinAttendancePct < 0 || r.gradMinAttendancePct > 100) return { ok: false, error: "Attendance is 0 to 100%" };
  const rows = await db.update(cohorts).set({ ...r, updatedAt: new Date() }).where(eq(cohorts.id, cohortId)).returning({ id: cohorts.id });
  if (!rows.length) return { ok: false, error: "Batch not found" };
  await audit(db, { userId, entity: "cohort", entityId: cohortId, action: "graduation_rules", diff: r });
  return { ok: true };
}

export type Standing = {
  enrolmentId: number;
  leadId: number;
  fullName: string;
  status: string;
  attendance: number | null; // 0..1, null when no class was marked
  passed: number;
  assignments: number;
  remaining: number;
  missing: string[]; // the rules not met, in words
  eligible: boolean;
  certificate: { code: string; revoked: boolean } | null;
};

/** Every student of the batch (not dropped) against the batch's graduation rules. */
export async function standings(db: Db, cohortId: number): Promise<{ rules: Rules; rows: Standing[] }> {
  const [c] = await db.select().from(cohorts).where(eq(cohorts.id, cohortId));
  if (!c) return { rules: { gradMinAttendancePct: 75, gradRequireAllPassed: true, gradRequirePaid: false }, rows: [] };
  const rules = { gradMinAttendancePct: c.gradMinAttendancePct, gradRequireAllPassed: c.gradRequireAllPassed, gradRequirePaid: c.gradRequirePaid };
  const [cands, att, work, certs] = await Promise.all([
    listCandidates(db, { cohortId }),
    attendanceSummary(db, cohortId),
    db.execute<{ enrolment_id: number; passed: number; total: number }>(sql`
      select e.id as enrolment_id,
        (select count(*) from submissions x join assignments a on a.id = x.assignment_id and a.deleted_at is null where x.enrolment_id = e.id and x.status = 'passed')::int as passed,
        (select count(*) from assignments a where a.cohort_id = e.cohort_id and a.deleted_at is null)::int as total
      from enrolments e where e.cohort_id = ${cohortId}`),
    db.select().from(certificates).innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId)).where(eq(enrolments.cohortId, cohortId)),
  ]);
  const workBy = new Map([...work].map((w) => [Number(w.enrolment_id), { passed: Number(w.passed), total: Number(w.total) }]));
  const certBy = new Map(certs.map((r) => [r.certificates.enrolmentId, { code: r.certificates.code, revoked: !!r.certificates.revokedAt }]));
  const rows = cands
    .filter((s) => s.status !== "dropped")
    .map((s): Standing => {
      const a = att.get(s.enrolmentId)?.rate ?? null;
      const w = workBy.get(s.enrolmentId) ?? { passed: 0, total: 0 };
      const missing: string[] = [];
      if (a !== null && a * 100 < rules.gradMinAttendancePct) missing.push(`attendance ${Math.round(a * 100)}% (needs ${rules.gradMinAttendancePct}%)`);
      if (rules.gradRequireAllPassed && w.passed < w.total) missing.push(`${w.total - w.passed} assignment${w.total - w.passed === 1 ? "" : "s"} not passed`);
      if (rules.gradRequirePaid && s.remaining > 0) missing.push("not paid in full");
      return { enrolmentId: s.enrolmentId, leadId: s.leadId, fullName: s.fullName, status: s.status, attendance: a, passed: w.passed, assignments: w.total, remaining: s.remaining, missing, eligible: missing.length === 0, certificate: certBy.get(s.enrolmentId) ?? null };
    });
  return { rules, rows };
}

const CODE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newCertificateCode = () => {
  const s = Array.from(randomBytes(8), (b) => CODE[b % CODE.length]).join("");
  return `OC-${s.slice(0, 4)}-${s.slice(4)}`;
};

/**
 * Graduate a student: status Graduated, a certificate, an alumni profile and a referral code. A student who does
 * not meet the rules graduates only with an owner's override and a reason, which the certificate keeps.
 */
export async function graduate(db: Db, enrolmentId: number, userId: number | null, opts: { override?: string | null; canOverride?: boolean } = {}): Promise<{ ok: true; code: string } | Fail> {
  const [e] = await db
    .select({ e: enrolments, fullName: leads.fullName, cohort: cohorts.name })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .innerJoin(cohorts, eq(cohorts.id, enrolments.cohortId))
    .where(eq(enrolments.id, enrolmentId));
  if (!e) return { ok: false, error: "Student not found" };
  if (e.e.status === "dropped") return { ok: false, error: "A dropped student cannot graduate" };
  const [existing] = await db.select().from(certificates).where(eq(certificates.enrolmentId, enrolmentId));
  if (existing && !existing.revokedAt) return { ok: true, code: existing.code };
  const s = (await standings(db, e.e.cohortId)).rows.find((r) => r.enrolmentId === enrolmentId);
  const override = opts.override?.trim() || null;
  if (s && !s.eligible) {
    if (!opts.canOverride) return { ok: false, error: `Not yet: ${s.missing.join(", ")}` };
    if (!override) return { ok: false, error: `Not yet: ${s.missing.join(", ")}. To graduate anyway, give the reason.` };
  }
  const code = newCertificateCode();
  await db.transaction(async (tx) => {
    await tx.update(enrolments).set({ status: "graduated", updatedAt: new Date() }).where(eq(enrolments.id, enrolmentId));
    const snapshot = { code, fullName: e.fullName, programme: TIER_LABEL[e.e.tier] ?? e.e.tier, batch: e.cohort, issuedAt: new Date(), issuedBy: userId, override: s?.eligible ? null : override, revokedAt: null, revokedBy: null, revokeReason: null };
    if (existing) await tx.update(certificates).set(snapshot).where(eq(certificates.id, existing.id));
    else await tx.insert(certificates).values({ enrolmentId, ...snapshot });
    await tx.insert(alumniProfiles).values({ leadId: e.e.leadId }).onConflictDoNothing();
    await audit(tx, { userId, entity: "enrolment", entityId: enrolmentId, action: "graduate", diff: { override: !!override && !s?.eligible } });
  });
  await ensureReferralCode(db, e.e.leadId);
  return { ok: true, code };
}

/** Owners only. The certificate's page then says it is no longer valid, and why. */
export async function revokeCertificate(db: Db, code: string, reason: string, userId: number | null): Promise<{ ok: true } | Fail> {
  if (!reason.trim()) return { ok: false, error: "Give the reason" };
  const rows = await db
    .update(certificates)
    .set({ revokedAt: new Date(), revokedBy: userId, revokeReason: reason.trim().slice(0, 300) })
    .where(and(eq(certificates.code, code), isNull(certificates.revokedAt)))
    .returning({ id: certificates.id });
  if (!rows.length) return { ok: false, error: "Certificate not found or already revoked" };
  await audit(db, { userId, entity: "certificate", entityId: code, action: "revoke" });
  return { ok: true };
}

export async function certificateByCode(db: Pick<Db, "select">, code: string) {
  const c = code.trim().toUpperCase();
  if (!/^OC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)) return null;
  const [row] = await db.select().from(certificates).where(eq(certificates.code, c));
  return row ?? null;
}

// ---------------- alumni ----------------

export const AVAILABILITY = { open: "Open to paid work", busy: "Busy for now", not_looking: "Not looking" } as const;

export async function listAlumni(db: Db, f: { availability?: keyof typeof AVAILABILITY; skill?: string } = {}) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select l.id as lead_id, l.full_name, l.phone_whatsapp, p.headline, p.skills, p.availability, p.portfolio_url, p.notes,
      (select string_agg(distinct c.name, ', ') from enrolments e join cohorts c on c.id = e.cohort_id where e.lead_id = l.id and e.status = 'graduated') as batches,
      (select string_agg(distinct e.tier::text, ',') from enrolments e where e.lead_id = l.id and e.status = 'graduated') as tiers,
      (select max(e.qc_score) from enrolments e where e.lead_id = l.id) as qc
    from alumni_profiles p join leads l on l.id = p.lead_id and l.deleted_at is null
    where true ${f.availability ? sql`and p.availability = ${f.availability}` : sql``}
      ${f.skill ? sql`and exists (select 1 from unnest(p.skills) k where lower(k) like ${`%${f.skill.toLowerCase().slice(0, 40)}%`})` : sql``}
    order by (p.availability = 'open') desc, qc desc nulls last, l.full_name`);
  return [...rows].map((r) => ({
    leadId: Number(r.lead_id),
    fullName: String(r.full_name),
    phone: (r.phone_whatsapp as string | null) ?? null,
    headline: (r.headline as string | null) ?? null,
    skills: (r.skills as string[]) ?? [],
    availability: r.availability as keyof typeof AVAILABILITY,
    portfolioUrl: (r.portfolio_url as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    batches: (r.batches as string | null) ?? "",
    tiers: String(r.tiers ?? "").split(",").filter(Boolean),
    qc: r.qc == null ? null : Number(r.qc),
  }));
}

export async function saveAlumniProfile(
  db: Db,
  leadId: number,
  p: { headline?: string | null; skills: string[]; availability: keyof typeof AVAILABILITY; portfolioUrl?: string | null; notes?: string | null },
  userId: number | null,
): Promise<{ ok: true } | Fail> {
  if (!(p.availability in AVAILABILITY)) return { ok: false, error: "Choose availability" };
  const url = p.portfolioUrl?.trim() || null;
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "The portfolio link must start with https://" };
  const skills = [...new Set(p.skills.map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 40)))].slice(0, 15);
  const values = { headline: p.headline?.trim().slice(0, 120) || null, skills, availability: p.availability, portfolioUrl: url, notes: p.notes?.trim().slice(0, 2000) || null, updatedAt: new Date() };
  await db.insert(alumniProfiles).values({ leadId, ...values }).onConflictDoUpdate({ target: alumniProfiles.leadId, set: values });
  await audit(db, { userId, entity: "alumni", entityId: leadId, action: "profile" });
  return { ok: true };
}

export async function alumniProfile(db: Db, leadId: number) {
  const [p] = await db.select().from(alumniProfiles).where(eq(alumniProfiles.leadId, leadId));
  return p ?? null;
}

export const certificatesFor = (db: Db, leadId: number) =>
  db
    .select({ c: certificates })
    .from(certificates)
    .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
    .where(eq(enrolments.leadId, leadId))
    .orderBy(asc(certificates.issuedAt));
