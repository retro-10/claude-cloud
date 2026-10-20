import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { resetRateLimit } from "@/lib/rate-limit";
import { hotp, base32Decode, stepAt } from "@/lib/totp";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// A cookie jar that keeps what the actions set, so the password step and the code step talk to each other
// the way a browser would.
const { Redirect, jar } = vi.hoisted(() => ({
  Redirect: class extends Error {
    url: string;
    constructor(u: string) {
      super("REDIRECT " + u);
      this.url = u;
    }
  },
  jar: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: () => new Headers({ "x-forwarded-for": "198.51.100.7" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Redirect(u);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function run(fn: () => Promise<unknown>) {
  try {
    return { result: await fn() };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.url };
    throw e;
  }
}

d("two-factor sign-in", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let A: typeof import("@/app/login/actions");
  let TF: typeof import("@/lib/two-factor");
  let S: typeof import("@/lib/session");
  let retro: number;
  const codeAt = (secret: string, ms: number) => hotp(base32Decode(secret), stepAt(ms));

  beforeAll(async () => {
    process.env.AUTH_SECRET = "t".repeat(48);
    process.env.DATABASE_URL = url;
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "the-real-password");
    A = await import("@/app/login/actions");
    TF = await import("@/lib/two-factor");
    S = await import("@/lib/session");
    retro = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  beforeEach(() => {
    jar.clear();
    resetRateLimit();
  });
  afterAll(() => client.end());

  it("without two-factor, the password alone signs in as before", async () => {
    expect(await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })))).toEqual({ redirect: "/" });
    expect(jar.has(S.SESSION_COOKIE)).toBe(true);
  });

  let secret = "";
  let recovery: string[] = [];
  it("setup: a wrong code does not turn it on; the right one does and gives 10 recovery codes once", async () => {
    await TF.beginSetup(db, retro);
    secret = (await TF.pendingSetup(db, retro))!.secret;
    const [row] = await db.select().from(s.users).where(eq(s.users.id, retro));
    expect(row.totpSecret).not.toContain(secret); // sealed at rest
    expect(await TF.confirmSetup(db, retro, "000000")).toMatchObject({ ok: false });
    expect((await TF.twoFactorStatus(db, retro)).enabled).toBe(false);
    const r = await TF.confirmSetup(db, retro, codeAt(secret, Date.now()));
    if (!r.ok) throw new Error(r.error);
    recovery = r.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(await TF.pendingSetup(db, retro)).toBeNull(); // the secret is never shown again
    expect(await TF.twoFactorStatus(db, retro)).toMatchObject({ enabled: true, recoveryLeft: 10 });
  });

  it("with two-factor, the password gives only a pass to the code page, never a session", async () => {
    expect(await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })))).toEqual({ redirect: "/login/verify" });
    expect(jar.has(S.SESSION_COOKIE)).toBe(false);
    const pending = jar.get(S.PENDING_2FA_COOKIE)!;
    // the pass cannot be used as a session, even pasted into the session cookie
    expect(await S.verifySession(pending)).toBeNull();
  });

  it("a wrong code is refused; the right code signs in; the same code cannot be used again", async () => {
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    expect(await run(() => A.verify2fa({}, fd({ code: "123456" })))).toEqual({ result: { error: "That code did not match" } });
    // the setup step used the current 30 seconds, so sign in with the next one (accepted for clock drift)
    const next = codeAt(secret, Date.now() + 30_000);
    expect(await run(() => A.verify2fa({}, fd({ code: next })))).toEqual({ redirect: "/" });
    expect(await S.verifySession(jar.get(S.SESSION_COOKIE))).toMatchObject({ id: retro });
    expect(jar.has(S.PENDING_2FA_COOKIE)).toBe(false);

    jar.clear();
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    expect(await run(() => A.verify2fa({}, fd({ code: next })))).toMatchObject({ result: { error: expect.stringMatching(/did not match|already used/) } });
    expect(jar.has(S.SESSION_COOKIE)).toBe(false);
  });

  it("a recovery code works once", async () => {
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    expect(await run(() => A.verify2fa({}, fd({ code: recovery[0].toUpperCase() })))).toEqual({ redirect: "/" });
    jar.clear();
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    expect(await run(() => A.verify2fa({}, fd({ code: recovery[0] })))).toEqual({ result: { error: "That code did not match" } });
    expect((await TF.twoFactorStatus(db, retro)).recoveryLeft).toBe(9);
  });

  it("five wrong codes lock the code step; no pass means start again", async () => {
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    for (let i = 0; i < 5; i++) await run(() => A.verify2fa({}, fd({ code: "000000" })));
    expect(await run(() => A.verify2fa({}, fd({ code: recovery[1] })))).toEqual({ result: { error: "Too many wrong codes. Try again in a few minutes." } });
    jar.clear();
    expect(await run(() => A.verify2fa({}, fd({ code: recovery[1] })))).toEqual({ result: { error: "That took too long. Sign in again." } });
  });

  it("a password change after the password step voids the pass", async () => {
    await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })));
    const [u] = await db.select().from(s.users).where(eq(s.users.id, retro));
    await db.update(s.users).set({ passwordHash: u.passwordHash + "x" }).where(eq(s.users.id, retro));
    expect(await run(() => A.verify2fa({}, fd({ code: recovery[2] })))).toEqual({ result: { error: "Sign in again." } });
    await db.update(s.users).set({ passwordHash: u.passwordHash }).where(eq(s.users.id, retro));
  });

  it("turning it off needs a current code; an owner reset clears it for a lost phone", async () => {
    expect(await TF.disableTwoFactor(db, retro, "000000")).toMatchObject({ ok: false });
    expect(await TF.disableTwoFactor(db, retro, recovery[3])).toEqual({ ok: true });
    expect((await TF.twoFactorStatus(db, retro)).enabled).toBe(false);
    await TF.beginSetup(db, retro);
    const sec = (await TF.pendingSetup(db, retro))!.secret;
    await TF.confirmSetup(db, retro, codeAt(sec, Date.now()));
    await TF.resetTwoFactor(db, retro, null);
    expect(await TF.twoFactorStatus(db, retro)).toEqual({ enabled: false, pending: false, recoveryLeft: 0, enabledAt: null });
    expect(await run(() => A.login({}, fd({ email: "retro@orladent.local", password: "the-real-password" })))).toEqual({ redirect: "/" });
  });
});
