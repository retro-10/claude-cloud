import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { enrolments, leads, studentAccounts } from "@/db/schema";
import { audit } from "./audit";
import { passwordVersion } from "./password-version";
import { normalizePhone } from "./phone";

export const MIN_STUDENT_PASSWORD = 10;
const INVITE_DAYS = 7;
const DUMMY = bcrypt.hashSync("not-a-real-password", 12);
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

type Fail = { ok: false; error: string };

/** A one-time link for a student to set their portal password (7 days). Making a new one cancels the old. */
export async function createInvite(db: Db, leadId: number, userId: number | null): Promise<{ ok: true; token: string } | Fail> {
  const [l] = await db.select({ deletedAt: leads.deletedAt, phone: leads.phoneWhatsapp }).from(leads).where(eq(leads.id, leadId));
  if (!l || l.deletedAt) return { ok: false, error: "Lead not found" };
  if (!l.phone) return { ok: false, error: "Add their WhatsApp number first: it is how they sign in" };
  const [e] = await db.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.leadId, leadId), sql`${enrolments.status} <> 'dropped'`)).limit(1);
  if (!e) return { ok: false, error: "Only enrolled students get portal access" };
  const token = randomBytes(32).toString("base64url");
  const values = { inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), active: true };
  await db.insert(studentAccounts).values({ leadId, ...values, createdBy: userId }).onConflictDoUpdate({ target: studentAccounts.leadId, set: values });
  await audit(db, { userId, entity: "portal", entityId: leadId, action: "invite" });
  return { ok: true, token };
}

export async function accountByInvite(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [a] = await db
    .select({ a: studentAccounts, fullName: leads.fullName })
    .from(studentAccounts)
    .innerJoin(leads, eq(leads.id, studentAccounts.leadId))
    .where(and(eq(studentAccounts.inviteTokenHash, hashToken(token)), gt(studentAccounts.inviteExpiresAt, new Date()), eq(studentAccounts.active, true), isNull(leads.deletedAt)));
  return a ? { ...a.a, fullName: a.fullName } : null;
}

/** Set the password from the invite; the link stops working. Returns what the session needs. */
export async function acceptInvite(db: Db, token: string, password: string): Promise<{ ok: true; accountId: number; pv: string } | Fail> {
  if (password.length < MIN_STUDENT_PASSWORD || password.length > 200) return { ok: false, error: `Use at least ${MIN_STUDENT_PASSWORD} characters` };
  const a = await accountByInvite(db, token);
  if (!a) return { ok: false, error: "This link has expired or was already used. Ask OrlaDent for a new one." };
  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await db
    .update(studentAccounts)
    .set({ passwordHash, inviteTokenHash: null, inviteExpiresAt: null, lastLoginAt: new Date() })
    .where(and(eq(studentAccounts.id, a.id), eq(studentAccounts.inviteTokenHash, hashToken(token))))
    .returning({ id: studentAccounts.id });
  if (!rows.length) return { ok: false, error: "This link was already used." };
  await audit(db, { userId: null, entity: "portal", entityId: a.leadId, action: "password_set" });
  return { ok: true, accountId: a.id, pv: passwordVersion(passwordHash) };
}

/** Sign in with the WhatsApp number (any format) and password. Same timing whether or not the number exists. */
export async function studentLogin(db: Db, phone: string, password: string): Promise<{ accountId: number; pv: string; leadId: number } | null> {
  const e164 = normalizePhone(phone);
  const [row] = e164
    ? await db
        .select({ a: studentAccounts })
        .from(studentAccounts)
        .innerJoin(leads, eq(leads.id, studentAccounts.leadId))
        .where(and(eq(leads.phoneWhatsapp, e164), isNull(leads.deletedAt)))
    : [];
  const ok = await bcrypt.compare(password, row?.a.passwordHash ?? DUMMY);
  if (!row || !ok || !row.a.active || !row.a.passwordHash) return null;
  await db.update(studentAccounts).set({ lastLoginAt: new Date() }).where(eq(studentAccounts.id, row.a.id));
  return { accountId: row.a.id, pv: passwordVersion(row.a.passwordHash), leadId: row.a.leadId };
}

/** Is this session still good: account active, password unchanged, lead not deleted. */
export async function studentFromSession(db: Db, s: { accountId: number; pv: string }) {
  const [row] = await db
    .select({ a: studentAccounts, fullName: leads.fullName, deletedAt: leads.deletedAt })
    .from(studentAccounts)
    .innerJoin(leads, eq(leads.id, studentAccounts.leadId))
    .where(eq(studentAccounts.id, s.accountId));
  if (!row || !row.a.active || row.deletedAt || !row.a.passwordHash || passwordVersion(row.a.passwordHash) !== s.pv) return null;
  return { accountId: row.a.id, leadId: row.a.leadId, fullName: row.fullName };
}

export async function setPortalActive(db: Db, leadId: number, active: boolean, userId: number | null) {
  // turning it off also cancels any open invite
  await db.update(studentAccounts).set({ active, ...(active ? {} : { inviteTokenHash: null, inviteExpiresAt: null }) }).where(eq(studentAccounts.leadId, leadId));
  await audit(db, { userId, entity: "portal", entityId: leadId, action: active ? "enable" : "disable" });
}

export async function portalStatus(db: Db, leadId: number) {
  const [a] = await db.select().from(studentAccounts).where(eq(studentAccounts.leadId, leadId));
  if (!a) return { state: "none" as const };
  if (!a.active) return { state: "off" as const };
  if (!a.passwordHash) return { state: a.inviteExpiresAt && a.inviteExpiresAt > new Date() ? ("invited" as const) : ("expired" as const), inviteExpiresAt: a.inviteExpiresAt };
  return { state: "active" as const, lastLoginAt: a.lastLoginAt };
}
