import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { resetRateLimit } from "@/lib/rate-limit";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const { Redirect, env } = vi.hoisted(() => ({
  Redirect: class extends Error {
    url: string;
    constructor(u: string) {
      super("REDIRECT " + u);
      this.url = u;
    }
  },
  env: { ip: "203.0.113.1", cookiesSet: [] as string[] },
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: (name: string) => void env.cookiesSet.push(name), delete: () => {} }),
  headers: () => new Headers({ "x-forwarded-for": env.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Redirect(u);
  },
}));

const form = (email: string, password: string) => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

d("login: rate limit counts failures only", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let login: (prev: unknown, f: FormData) => Promise<{ error?: string } | void>;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "l".repeat(48);
    process.env.DATABASE_URL = url;
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "the-real-password");
    login = (await import("@/app/login/actions")).login as never;
  });
  beforeEach(() => {
    resetRateLimit();
    env.cookiesSet.length = 0;
  });
  afterAll(() => client.end());

  const attempt = async (email: string, pw: string) => {
    try {
      return { result: await login({}, form(email, pw)) };
    } catch (e) {
      if (e instanceof Redirect) return { redirect: e.url };
      throw e;
    }
  };

  it("signing in correctly many times in a row is never throttled", async () => {
    for (let i = 0; i < 12; i++) expect(await attempt("retro@orladent.local", "the-real-password")).toEqual({ redirect: "/" });
    expect(env.cookiesSet).toHaveLength(12);
  });

  it("five wrong guesses lock that account from that address; the correct password is then refused too", async () => {
    for (let i = 0; i < 5; i++) expect(await attempt("badr@orladent.local", `guess ${i}`)).toEqual({ result: { error: "Wrong email or password." } });
    const blocked = await attempt("badr@orladent.local", "the-real-password");
    expect(blocked).toEqual({ result: { error: "Too many failed attempts. Try again in a few minutes." } });
    expect(env.cookiesSet).toHaveLength(0); // no session was issued
  });

  it("the lock is per account and address: another account, and another address, still work", async () => {
    for (let i = 0; i < 5; i++) await attempt("badr@orladent.local", `guess ${i}`);
    expect(await attempt("sayed@orladent.local", "the-real-password")).toEqual({ redirect: "/" });
    env.ip = "203.0.113.99";
    expect(await attempt("badr@orladent.local", "the-real-password")).toEqual({ redirect: "/" });
    env.ip = "203.0.113.1";
  });

  it("a successful sign-in clears that account's earlier failures", async () => {
    for (let i = 0; i < 4; i++) await attempt("sayed@orladent.local", `typo ${i}`);
    expect(await attempt("sayed@orladent.local", "the-real-password")).toEqual({ redirect: "/" });
    for (let i = 0; i < 4; i++) await attempt("sayed@orladent.local", `typo again ${i}`); // 4 more: still under the limit
    expect(await attempt("sayed@orladent.local", "the-real-password")).toEqual({ redirect: "/" });
  });

  it("one address guessing across many accounts is stopped at 20 failures", async () => {
    const emails = ["retro", "badr", "sayed", "mo", "a1", "a2", "a3", "a4", "a5", "a6"].map((n) => `${n}@orladent.local`);
    let last: unknown;
    for (let i = 0; i < 21; i++) last = await attempt(emails[i % emails.length], `wrong ${i}`);
    expect(last).toEqual({ result: { error: "Too many failed attempts. Try again in a few minutes." } });
    expect(await attempt("retro@orladent.local", "the-real-password")).toEqual({ result: { error: "Too many failed attempts. Try again in a few minutes." } });
  }, 30_000); // 21 real bcrypt checks at ~250 ms each

  it("failed sign-ins are audited without the email or password", async () => {
    await attempt("mo@orladent.local", "definitely-wrong-password");
    const rows = await client`select entity, action, entity_id, diff, user_id from audit_log where action = 'login_failed'`;
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("definitely-wrong-password");
    expect(JSON.stringify(rows)).not.toContain("mo@orladent.local");
  });
});
