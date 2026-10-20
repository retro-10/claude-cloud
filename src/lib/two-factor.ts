import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "./audit";
import { hashRecovery, newRecoveryCodes, newSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from "./totp";

type Fail = { ok: false; error: string };

export async function twoFactorStatus(db: Pick<Db, "select">, userId: number) {
  const [u] = await db.select({ secret: users.totpSecret, enabledAt: users.totpEnabledAt, codes: users.recoveryCodes }).from(users).where(eq(users.id, userId));
  return { enabled: !!u?.enabledAt, pending: !!u?.secret && !u.enabledAt, recoveryLeft: u?.codes.length ?? 0, enabledAt: u?.enabledAt ?? null };
}

/** Step 1: a new secret, kept (sealed) but not active until a code from the app confirms it. */
export async function beginSetup(db: Db, userId: number): Promise<{ ok: true } | Fail> {
  const s = await twoFactorStatus(db, userId);
  if (s.enabled) return { ok: false, error: "Two-factor sign-in is already on" };
  await db.update(users).set({ totpSecret: sealSecret(newSecret()), totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, userId));
  return { ok: true };
}

/** The secret being set up, for the QR code and the manual key. Null once enabled: it is never shown again. */
export async function pendingSetup(db: Db, userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.totpSecret || u.totpEnabledAt) return null;
  const secret = openSecret(u.totpSecret);
  return secret ? { secret, uri: otpauthUri(secret, u.email) } : null;
}

/** Step 2: the first code from the app turns it on and returns the recovery codes, shown once. */
export async function confirmSetup(db: Db, userId: number, code: string, now = Date.now()): Promise<{ ok: true; recoveryCodes: string[] } | Fail> {
  const p = await pendingSetup(db, userId);
  if (!p) return { ok: false, error: "Start the setup again" };
  const step = verifyTotp(p.secret, code, now);
  if (step === null) return { ok: false, error: "That code did not match. Check the time on your phone and try the newest code." };
  const codes = newRecoveryCodes();
  await db.update(users).set({ totpEnabledAt: new Date(now), totpLastStep: step, recoveryCodes: codes.map(hashRecovery) }).where(eq(users.id, userId));
  await audit(db, { userId, entity: "auth", entityId: userId, action: "2fa_on" });
  return { ok: true, recoveryCodes: codes };
}

/**
 * The second step of signing in: a code from the app, or one recovery code. Both are single-use, enforced in
 * the UPDATE itself so two requests racing with the same code cannot both pass.
 */
export async function verifySecondFactor(db: Db, userId: number, input: string, now = Date.now()): Promise<{ ok: true; used: "app" | "recovery" } | Fail> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u?.totpEnabledAt || !u.totpSecret || !u.active) return { ok: false, error: "Sign in again" };
  const code = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const secret = openSecret(u.totpSecret);
    if (!secret) return { ok: false, error: "Two-factor needs resetting by an owner" };
    const step = verifyTotp(secret, code, now, u.totpLastStep);
    if (step === null) return { ok: false, error: "That code did not match" };
    const rows = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), sql`${users.totpLastStep} < ${step}`)))
      .returning({ id: users.id });
    return rows.length ? { ok: true, used: "app" } : { ok: false, error: "That code was already used" };
  }
  const h = hashRecovery(code);
  const rows = await db
    .update(users)
    .set({ recoveryCodes: sql`${users.recoveryCodes} - ${h}::text` })
    .where(and(eq(users.id, userId), sql`${users.recoveryCodes} ? ${h}::text`))
    .returning({ left: users.recoveryCodes });
  if (!rows.length) return { ok: false, error: "That code did not match" };
  await audit(db, { userId, entity: "auth", entityId: userId, action: "2fa_recovery_used", diff: { left: rows[0].left.length } });
  return { ok: true, used: "recovery" };
}

/** Turning it off needs a current code, so a borrowed session cannot quietly remove it. */
export async function disableTwoFactor(db: Db, userId: number, code: string, now = Date.now()): Promise<{ ok: true } | Fail> {
  const v = await verifySecondFactor(db, userId, code, now);
  if (!v.ok) return v;
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, userId));
  await audit(db, { userId, entity: "auth", entityId: userId, action: "2fa_off" });
  return { ok: true };
}

/** New recovery codes (the old ones stop working), after a current code. */
export async function regenerateRecoveryCodes(db: Db, userId: number, code: string, now = Date.now()): Promise<{ ok: true; recoveryCodes: string[] } | Fail> {
  const v = await verifySecondFactor(db, userId, code, now);
  if (!v.ok) return v;
  const codes = newRecoveryCodes();
  await db.update(users).set({ recoveryCodes: codes.map(hashRecovery) }).where(eq(users.id, userId));
  await audit(db, { userId, entity: "auth", entityId: userId, action: "2fa_new_recovery_codes" });
  return { ok: true, recoveryCodes: codes };
}

/** An owner clears someone's two-factor (a lost phone). They sign in with the password and set it up again. */
export async function resetTwoFactor(db: Db, userId: number, actorId: number | null) {
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(users.id, userId));
  await audit(db, { userId: actorId, entity: "user", entityId: userId, action: "2fa_reset" });
}
