import { beforeAll, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { signSession, verifySession } from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "x".repeat(48);
});

describe("session token", () => {
  const user = { id: 7, name: "Retro", email: "retro@orladent.local", role: "owner" as const };

  it("round-trips a signed session", async () => {
    expect(await verifySession(await signSession(user))).toEqual(user);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(user);
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(user);
    process.env.AUTH_SECRET = "y".repeat(48);
    expect(await verifySession(token)).toBeNull();
    process.env.AUTH_SECRET = "x".repeat(48);
  });

  it("rejects missing token", async () => {
    expect(await verifySession(undefined)).toBeNull();
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
