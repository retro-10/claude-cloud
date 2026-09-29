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
  return new SignJWT({ name: user.name, email: user.email, role: user.role, pv })
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
