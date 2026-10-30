"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { authenticate } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { passwordVersion } from "@/lib/password-version";
import { clearHits, isLimited, recordHit } from "@/lib/rate-limit";
import { PENDING_2FA_COOKIE, SESSION_COOKIE, cookieOptions, pendingCookieOptions, signPending2fa, signSession, verifyPending2fa } from "@/lib/session";
import { twoFactorStatus, verifySecondFactor } from "@/lib/two-factor";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// Configurable so automated test runs (which sign in constantly) are not throttled; keep the defaults in production.
const MAX_PER_ACCOUNT = Number(process.env.LOGIN_MAX_FAILED_PER_ACCOUNT ?? 5);
const MAX_PER_IP = Number(process.env.LOGIN_MAX_FAILED_PER_IP ?? 20);

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const email = parsed.data.email.toLowerCase();
  // Only FAILED attempts count: 5 per 15 min per email+IP, and 20 per 15 min per IP overall.
  // Signing in normally (or several times) never locks anyone out; guessing does.
  const WINDOW = 15 * 60_000;
  const acct = `login:${ip}:${email}`;
  const ipKey = `login-ip:${ip}`;
  if (isLimited(acct, MAX_PER_ACCOUNT, WINDOW).limited || isLimited(ipKey, MAX_PER_IP, WINDOW).limited) {
    return { error: "Too many failed attempts. Try again in a few minutes." };
  }

  const user = await authenticate(db, email, parsed.data.password);
  if (!user) {
    recordHit(acct, WINDOW);
    recordHit(ipKey, WINDOW);
    await audit(db, { userId: null, entity: "auth", action: "login_failed" });
    return { error: "Wrong email or password." };
  }
  clearHits(acct);

  const { pv, ...sessionUser } = user;
  // two-factor on: the password alone gives only a 5-minute pass to the code page, never a session
  if ((await twoFactorStatus(db, user.id)).enabled) {
    (await cookies()).set(PENDING_2FA_COOKIE, await signPending2fa(user.id, pv), pendingCookieOptions());
    await audit(db, { userId: user.id, entity: "auth", entityId: user.id, action: "login_password_ok" });
    redirect("/login/verify");
  }
  (await cookies()).set(SESSION_COOKIE, await signSession(sessionUser, pv), cookieOptions());
  await audit(db, { userId: user.id, entity: "auth", entityId: user.id, action: "login" });
  redirect("/");
}

const MAX_CODE_TRIES = Number(process.env.LOGIN_MAX_FAILED_PER_ACCOUNT ?? 5);

// The second step: a code from the authenticator app, or a recovery code.
export async function verify2fa(_prev: LoginState, form: FormData): Promise<LoginState> {
  const jar = await cookies();
  const pending = await verifyPending2fa(jar.get(PENDING_2FA_COOKIE)?.value);
  if (!pending) return { error: "That took too long. Sign in again." };
  const code = String(form.get("code") ?? "").slice(0, 40);
  const WINDOW = 15 * 60_000;
  const key = `2fa:${pending.id}`;
  if (isLimited(key, MAX_CODE_TRIES, WINDOW).limited) return { error: "Too many wrong codes. Try again in a few minutes." };

  const [u] = await db.select().from(users).where(eq(users.id, pending.id));
  // the password must still be the one just checked, and the account still active
  if (!u || !u.active || passwordVersion(u.passwordHash) !== pending.pv) return { error: "Sign in again." };
  const r = await verifySecondFactor(db, u.id, code);
  if (!r.ok) {
    recordHit(key, WINDOW);
    await audit(db, { userId: u.id, entity: "auth", entityId: u.id, action: "2fa_failed" });
    return { error: r.error };
  }
  clearHits(key);
  jar.delete({ name: PENDING_2FA_COOKIE, path: "/login" });
  jar.set(SESSION_COOKIE, await signSession({ id: u.id, name: u.name, email: u.email, role: u.role }, pending.pv), cookieOptions());
  await audit(db, { userId: u.id, entity: "auth", entityId: u.id, action: "login", diff: { factor: r.used } });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
