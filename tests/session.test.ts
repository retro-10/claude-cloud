import { beforeAll, describe, expect, it } from "vitest";
import { passwordVersion } from "@/lib/password-version";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { SignJWT } from "jose";
import { signPending2fa, signSession, verifyPending2fa, verifySession } from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "x".repeat(48);
});

describe("session token", () => {
  const user = { id: 7, name: "Retro", email: "retro@orladent.local", role: "owner" as const };

  it("round-trips a signed session, including the password fingerprint", async () => {
    expect(await verifySession(await signSession(user, "pv1"))).toEqual({ ...user, pv: "pv1" });
  });

  it("keeps sessions and the two-factor pass apart, and still accepts sessions signed before the purpose field", async () => {
    const pass = await signPending2fa(7, "pv1");
    expect(await verifySession(pass)).toBeNull();
    expect(await verifyPending2fa(pass)).toEqual({ id: 7, pv: "pv1" });
    expect(await verifyPending2fa(await signSession(user, "pv1"))).toBeNull();
    const legacy = await new SignJWT({ name: user.name, email: user.email, role: user.role, pv: "pv1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("7")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    expect(await verifySession(legacy)).toEqual({ ...user, pv: "pv1" });
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(user, "pv1");
    // flip a character in the middle of the signature (the last chars of a base64url string can carry
    // unused bits, so changing only those would not change the decoded signature)
    const i = token.length - 12;
    const flipped = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
    expect(await verifySession(flipped)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(user, "pv1");
    process.env.AUTH_SECRET = "y".repeat(48);
    expect(await verifySession(token)).toBeNull();
    process.env.AUTH_SECRET = "x".repeat(48);
  });

  it("rejects missing token", async () => {
    expect(await verifySession(undefined)).toBeNull();
  });
});

describe("password version", () => {
  it("changes whenever the hash changes and is stable otherwise", () => {
    expect(passwordVersion("$2a$12$abc")).toBe(passwordVersion("$2a$12$abc"));
    expect(passwordVersion("$2a$12$abc")).not.toBe(passwordVersion("$2a$12$abd"));
    expect(passwordVersion("$2a$12$abc")).toHaveLength(16);
  });
});

describe("rate limit", () => {
  it("blocks after max hits inside the window and recovers after it", () => {
    resetRateLimit();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(rateLimit("k", 5, 60_000, t0 + i).ok).toBe(true);
    expect(rateLimit("k", 5, 60_000, t0 + 10).ok).toBe(false);
    expect(rateLimit("k", 5, 60_000, t0 + 61_000).ok).toBe(true);
  });
});
