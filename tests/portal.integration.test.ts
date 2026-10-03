import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { resetRateLimit } from "@/lib/rate-limit";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

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
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: () => new Headers({ "x-forwarded-for": "198.51.100.33" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Redirect(u);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
async function run<T>(fn: () => Promise<T>) {
  try {
    return { result: await fn() };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.url };
    throw e;
  }
}

d("student portal", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let P: typeof import("@/lib/portal");
  let A: typeof import("@/app/portal/actions");
  let S: typeof import("@/lib/session");
  let D: typeof import("@/lib/portal-data");
  let userId: number, b1: number, b2: number, mine: number, theirs: number;
  const lead: Record<string, number> = {};
  let token = "";

  beforeAll(async () => {
    process.env.AUTH_SECRET = "p".repeat(48);
    process.env.DATABASE_URL = url;
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    P = await import("@/lib/portal");
    A = await import("@/app/portal/actions");
    S = await import("@/lib/session");
    D = await import("@/lib/portal-data");
    userId = (await db.select().from(s.users))[0].id;
    [{ id: b1 }, { id: b2 }] = await db.insert(s.cohorts).values([{ name: "B1", seatCap: 40 }, { name: "B2", seatCap: 40 }]).returning();
    for (const [k, phone, cohort] of [["mona", "+201011110001", b1], ["omar", "+201011110002", b2], ["lead", "+201011110003", null]] as const) {
      const [l] = await db.insert(s.leads).values({ fullName: `${k} student`, phoneWhatsapp: phone }).returning();
      lead[k] = l.id;
      if (cohort) await db.insert(s.enrolments).values({ leadId: l.id, cohortId: cohort, tier: "foundation", amountEgp: 7500 });
    }
    const rubric = [{ name: "Fit", max: 100 }];
    [{ id: mine }, { id: theirs }] = await db.insert(s.assignments).values([{ cohortId: b1, title: "Mona's case", rubric }, { cohortId: b2, title: "Omar's case", rubric }]).returning();
  });
  beforeEach(() => resetRateLimit());
  afterAll(() => client.end());

  it("an invite is only for an enrolled student with a number; the link is single-use", async () => {
    expect(await P.createInvite(db, lead.lead, userId)).toEqual({ ok: false, error: "Only enrolled students get portal access" });
    const r = await P.createInvite(db, lead.mona, userId);
    if (!r.ok) throw new Error(r.error);
    token = r.token;
    const [acc] = await db.select().from(s.studentAccounts).where(eq(s.studentAccounts.leadId, lead.mona));
    expect(acc.inviteTokenHash).not.toBe(token); // only the hash is stored
    expect(await P.accountByInvite(db, token)).toMatchObject({ leadId: lead.mona });
    expect(await run(() => A.acceptInviteAction({}, fd({ token, password: "short", confirm: "short" })))).toMatchObject({ result: { error: expect.stringContaining("10 characters") } });
    expect(await run(() => A.acceptInviteAction({}, fd({ token, password: "a long password", confirm: "a long password" })))).toEqual({ redirect: "/portal" });
    expect(jar.has(S.STUDENT_COOKIE)).toBe(true);
    expect(await P.accountByInvite(db, token)).toBeNull();
    expect(await run(() => A.acceptInviteAction({}, fd({ token, password: "another password", confirm: "another password" })))).toMatchObject({ result: { error: expect.stringContaining("expired or was already used") } });
  });

  it("student and staff sessions are never interchangeable", async () => {
    const student = jar.get(S.STUDENT_COOKIE)!;
    expect(await S.verifySession(student)).toBeNull();
    const staff = await S.signSession({ id: userId, name: "x", email: "x@y", role: "owner" }, "pv");
    expect(await S.verifyStudent(staff)).toBeNull();
    expect(await S.verifyStudent(await S.signPending2fa(userId, "pv"))).toBeNull();
  });

  it("sign-in with the number in any format; wrong passwords are limited", async () => {
    jar.clear();
    expect(await run(() => A.portalLogin({}, fd({ phone: "0101 111 0001", password: "a long password" })))).toEqual({ redirect: "/portal" });
    jar.clear();
    for (let i = 0; i < 5; i++) expect(await run(() => A.portalLogin({}, fd({ phone: "01011110001", password: `nope ${i}` })))).toMatchObject({ result: { error: expect.stringContaining("Wrong") } });
    expect(await run(() => A.portalLogin({}, fd({ phone: "01011110001", password: "a long password" })))).toMatchObject({ result: { error: expect.stringContaining("Too many") } });
    expect(jar.has(S.STUDENT_COOKIE)).toBe(false);
  });

  it("a student sends work only for their own batch, and sees only their own things", async () => {
    resetRateLimit();
    await run(() => A.portalLogin({}, fd({ phone: "01011110001", password: "a long password" })));
    expect(await run(() => A.submitWorkAction({}, fd({ assignmentId: String(theirs), link: "https://drive.example/x" })))).toEqual({ result: { error: "This assignment is not in your batch." } });
    expect(await run(() => A.submitWorkAction({}, fd({ assignmentId: String(mine), link: "https://drive.example/mona", note: "My first crown" })))).toMatchObject({ result: { done: expect.stringContaining("Sent") } });
    const [sub] = await db.select().from(s.submissions);
    expect(sub).toMatchObject({ assignmentId: mine, link: "https://drive.example/mona", note: "My first crown", status: "submitted" });
    const view = await D.portalOverview(db, lead.mona);
    expect(view.map((v) => v.enrolment.cohort)).toEqual(["B1"]);
    expect(view[0].work.map((w) => w.a.title)).toEqual(["Mona's case"]);
  });

  it("no session, or a switched-off account, or a new password: the old session stops working", async () => {
    jar.clear();
    expect(await run(() => A.submitWorkAction({}, fd({ assignmentId: String(mine), link: "https://x.example" })))).toEqual({ redirect: "/portal/login" });
    await run(() => A.portalLogin({}, fd({ phone: "01011110001", password: "a long password" })));
    const session = (await S.verifyStudent(jar.get(S.STUDENT_COOKIE)))!;
    expect(await P.studentFromSession(db, session)).toMatchObject({ leadId: lead.mona });
    await P.setPortalActive(db, lead.mona, false, userId);
    expect(await P.studentFromSession(db, session)).toBeNull();
    await P.setPortalActive(db, lead.mona, true, userId);
    const again = await P.createInvite(db, lead.mona, userId);
    if (!again.ok) throw new Error(again.error);
    await P.acceptInvite(db, again.token, "a brand new password");
    expect(await P.studentFromSession(db, session)).toBeNull(); // signed in with the old password
  });
});
