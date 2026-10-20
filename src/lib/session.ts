import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./rbac";

export const SESSION_COOKIE = "crm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type SessionUser = { id: number; name: string; email: string; role: Role };
// pv = fingerprint of the password hash: changing or resetting a password invalidates every older session
export type SessionClaims = SessionUser & { pv: string };

// Edge-safe (used by middleware): no DB or Node-only imports here.
function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser, pv: string): Promise<string> {
  return new SignJWT({ purpose: "session", name: user.name, email: user.email, role: user.role, pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    // a token made for anything else (the 2FA step) is never a session; tokens from before this field have none
    if (payload.purpose !== undefined && payload.purpose !== "session") return null;
    return {
      id: Number(payload.sub),
      name: String(payload.name),
      email: String(payload.email),
      role: payload.role as Role,
      pv: String(payload.pv ?? ""),
    };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const, // also our CSRF baseline; middleware additionally checks Origin on writes
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// Between the password and the second factor: a 5-minute token that only the code page accepts.
// It is not a session: middleware and every page check SESSION_COOKIE, never this one.
export const PENDING_2FA_COOKIE = "crm_2fa";
const PENDING_TTL_SECONDS = 5 * 60;

export async function signPending2fa(userId: number, pv: string): Promise<string> {
  return new SignJWT({ purpose: "2fa", pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifyPending2fa(token: string | undefined): Promise<{ id: number; pv: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa") return null;
    return { id: Number(payload.sub), pv: String(payload.pv ?? "") };
  } catch {
    return null;
  }
}

export function pendingCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.COOKIE_SECURE === "true", path: "/login", maxAge: PENDING_TTL_SECONDS };
}

// The student portal's own session: a separate cookie and purpose. Staff pages refuse it (purpose is not
// "session"), and the portal refuses staff tokens (purpose is not "student").
export const STUDENT_COOKIE = "orla_student";
const STUDENT_TTL_SECONDS = 60 * 60 * 24 * 14;

export async function signStudent(accountId: number, pv: string): Promise<string> {
  return new SignJWT({ purpose: "student", pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(accountId))
    .setIssuedAt()
    .setExpirationTime(`${STUDENT_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifyStudent(token: string | undefined): Promise<{ accountId: number; pv: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.purpose !== "student") return null;
    return { accountId: Number(payload.sub), pv: String(payload.pv ?? "") };
  } catch {
    return null;
  }
}

export function studentCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.COOKIE_SECURE === "true", path: "/portal", maxAge: STUDENT_TTL_SECONDS };
}
