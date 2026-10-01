import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { passwordVersion } from "@/lib/password-version";
import { signSession } from "@/lib/session";
import { createUser, resetPassword, updateUser } from "@/lib/settings";
import { createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

// The role rules are enforced on the server. These tests call the REAL server actions and route handlers
// with a real signed session cookie against a real database, once per role, and check both sides:
// what a role may do actually works, and what it may not do is refused and changes nothing.
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
  jar: { cookie: undefined as string | undefined },
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "crm_session" && jar.cookie ? { name, value: jar.cookie } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Redirect(u);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

// a redirect back with ?error= means the action ran but failed: for these entries that is not "worked"
async function strict(fn: () => unknown) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Redirect && e.url.includes("error=")) throw new Error(`failed: ${decodeURIComponent(e.url)}`);
    throw e;
  }
}
type Outcome = { kind: "ok"; value: unknown } | { kind: "redirect"; url: string } | { kind: "forbidden" } | { kind: "error"; message: string };
async function attempt(fn: () => unknown): Promise<Outcome> {
  try {
    return { kind: "ok", value: await fn() };
  } catch (e) {
    if (e instanceof Redirect) return { kind: "redirect", url: e.url };
    const message = e instanceof Error ? e.message : String(e);
    return message === "Forbidden" ? { kind: "forbidden" } : { kind: "error", message };
  }
}
const fd = (o: Record<string, string | number>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, String(v));
  return f;
};

d("role rules on the server", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const ROLES = ["owner", "sales", "viewer", "finance"] as const;
  const email = (r: string) => `${r}@roles.local`;
  let n = 0;
  let cohortId: number, enrolmentId: number, leadId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let A: Record<string, any> = {};

  async function signInAs(e: string | null) {
    if (!e) return void (jar.cookie = undefined);
    const [u] = await db.select().from(s.users).where(eq(s.users.email, e));
    jar.cookie = await signSession({ id: u.id, name: u.name, email: u.email, role: u.role }, passwordVersion(u.passwordHash));
  }
  const freshLead = async () => {
    const r = await createLead(db, { fullName: `T${++n}`, phone: `0150${String(n).padStart(7, "0")}` }, null);
    if (!r.ok) throw new Error("setup");
    return r.lead.id;
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET = "z".repeat(48);
    process.env.DATABASE_URL = url;
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    for (const r of ROLES) await createUser(db, { name: r, email: email(r), role: r, password: "long enough pw" }, null);
    leadId = await freshLead();
    [cohortId] = (await db.insert(s.cohorts).values({ name: "Roles", seatCap: 50 }).returning()).map((c) => c.id);
    const l = await freshLead();
    await db.insert(s.enrolments).values({ leadId: l, cohortId, tier: "foundation", amountEgp: 7500 });
    enrolmentId = (await db.select().from(s.enrolments))[0].id;

    // import the actions only now, after DATABASE_URL is set (they import the shared db client)
    A = {
      ...(await import("@/app/(app)/leads/actions")),
      ...(await import("@/app/(app)/pipeline/actions")),
      ...(await import("@/app/(app)/followups/actions")),
      ...(await import("@/app/(app)/consults/actions")),
      ...(await import("@/app/(app)/cohorts/actions")),
      ...(await import("@/app/(app)/settings/actions")),
      ...(await import("@/app/(app)/leads/import/actions")),
      ...(await import("@/app/(app)/finance/actions")),
      ...(await import("@/app/(app)/settings/integrations/actions")),
      ...(await import("@/app/(app)/programme/actions")),
      ...(await import("@/app/(app)/settings/team/actions")),
      ...(await import("@/app/(app)/tasks/actions")),
      ...(await import("@/app/(app)/settings/targets/actions")),
      ...(await import("@/app/(app)/command/actions")),
      ...(await import("@/app/(app)/tools/actions")),
      ...(await import("@/app/(app)/files/actions")),
      ...(await import("@/app/(app)/growth/actions")),
    };
  });
  afterAll(async () => {
    jar.cookie = undefined;
    await client.end();
  });

  // action -> roles allowed. Every action is called with valid input, so "allowed" means it truly worked.
  const matrix: [string, readonly string[], () => unknown][] = [
    ["addActivity", ["owner", "sales"], () => A.addActivity(fd({ id: leadId, type: "note", direction: "internal", body: "x" }))],
    ["updateLeadAction", ["owner", "sales"], () => A.updateLeadAction({}, fd({ id: leadId, fullName: "Renamed", phone: "", email: "", city: "", segment: "", sourceId: "", tierInterest: "unsure", ownerId: "", notes: "" }))],
    ["quickAddLead", ["owner", "sales"], () => A.quickAddLead({}, fd({ fullName: "Q", phone: `0160${String(++n).padStart(7, "0")}`, sourceId: "" }))],
    ["moveLead", ["owner", "sales"], () => A.moveLead({ leadId, stage: "contacted" })],
    ["enrolAction", ["owner", "sales"], async () => A.enrolAction({ leadId: await freshLead(), cohortId, tier: "foundation", amountEgp: 7500 })],
    ["addFollowUpAction", ["owner", "sales"], () => A.addFollowUpAction(fd({ id: leadId, date: "2030-01-01" }))],
    ["bulkAction", ["owner", "sales"], () => A.bulkAction(fd({ op: "owner", ownerId: "", ids: leadId }))],
    ["bookConsultAction", ["owner", "sales"], () => A.bookConsultAction(fd({ leadId, when: "2030-01-01T10:00" }))],
    ["runImport", ["owner", "sales"], () => A.runImport({ rows: [{ fullName: "Imp", phone: `0170${String(++n).padStart(7, "0")}` }], updateExisting: false, dryRun: true })],
    ["deleteLeadAction", ["owner"], async () => A.deleteLeadAction(fd({ id: await freshLead() }))],
    ["createCohortAction", ["owner"], () => A.createCohortAction(fd({ name: `C${++n}`, seatCap: 5 }))],
    ["addListItemAction", ["owner"], () => A.addListItemAction(fd({ list: "sources", label: `S${++n}` }))],
    ["saveTemplateAction", ["owner"], () => A.saveTemplateAction(fd({ name: `T${++n}`, steps: "0 | whatsapp | Hi" }))],
    ["createUserAction", ["owner"], () => A.createUserAction(fd({ name: "New", email: `new${++n}@roles.local`, role: "viewer", password: "long enough pw" }))],
    ["updateUserAction", ["owner"], async () => A.updateUserAction(fd({ id: (await db.select().from(s.users).where(eq(s.users.email, email("viewer"))))[0].id, role: "viewer", name: "viewer", active: "on" }))],
    ["recordPaymentAction", ["owner", "finance"], () => A.recordPaymentAction(fd({ enrolmentId, amountEgp: 500, date: "2026-09-01", status: "received", reference: "", back: "/finance" }))],
    ["saveEntryAction", ["owner", "finance"], () => A.saveEntryAction(fd({ entry: "Ads", amountEgp: 900, date: "", section: "variable_costs", category: "Content creator", status: "paid", back: "/finance" }))],
    ["updateCandidateAction", ["owner", "finance"], () => A.updateCandidateAction(fd({ enrolmentId, tier: "foundation", amountEgp: 7500, discountEgp: 0, paymentPlan: "one_time", finalInstalmentAt: "", status: "active", back: "/finance" }))],
    ["saveSplitAction", ["owner"], () => A.saveSplitAction(fd({ partnerName: "Badr", partnerPct: 80, capitalPct: 20, back: "/settings/finance" }))],
    ["syncNotionAction", ["owner"], () => A.syncNotionAction()],
    ["saveTeamMemberAction", ["owner"], () => A.saveTeamMemberAction(fd({ name: `T${++n}`, role: "Video Editor", status: "Active" }))],
    ["updateProgrammeAction", ["owner", "sales"], () => A.updateProgrammeAction(fd({ enrolmentId, qcScore: "80", leaderboardRank: "", contentConsent: "on", contentConsentScope: "Video", back: "/proof" }))],
    ["saveSessionAction", ["owner", "sales"], () => A.saveSessionAction(fd({ enrolmentId, name: `S${++n}`, type: "Production Partner 1:1", back: "/proof" }))],
    ["saveProofAction", ["owner", "sales"], () => A.saveProofAction(fd({ enrolmentId, name: `P${++n}`, consentStatus: "Asked", back: "/proof" }))],
    ["createTaskAction", ["owner", "sales", "finance"], () => strict(() => A.createTaskAction(fd({ title: `Task ${++n}`, leadId, due: "2030-01-01", back: "/tasks" })))],
    ["taskStateAction", ["owner", "sales", "finance"], async () => {
      const [t] = await db.insert(s.tasks).values({ title: `Task ${++n}` }).returning();
      return strict(() => A.taskStateAction(fd({ id: t.id, state: "done", back: "/tasks" })));
    }],
    ["saveTargetsAction", ["owner"], () => strict(() => A.saveTargetsAction(fd({ period: "2026-Q4", leads: "120", enrolments: "40" })))],
    ["saveReviewAction", ["owner"], () => strict(() => A.saveReviewAction(fd({ week: "2026-10-05", wins: "A good week" })))],
    ["saveOfferToLeadAction", ["owner", "sales"], () => strict(() => A.saveOfferToLeadAction(fd({ leadId, tier: "foundation", amount: 7000, link: "", decision: "2030-01-10" })))],
    ["resetTwoFactorAction", ["owner"], async () => A.resetTwoFactorAction(fd({ id: (await db.select().from(s.users).where(eq(s.users.email, email("viewer"))))[0].id }))],
    ["uploadFileAction", ["owner", "sales", "finance"], () => {
      const f = fd({ leadId, back: `/leads/${leadId}` });
      f.set("file", new File([Buffer.from("%PDF-1.4")], "receipt.pdf", { type: "application/pdf" }));
      return strict(() => A.uploadFileAction(f));
    }],
    ["saveCampaignAction", ["owner", "sales"], () => strict(() => A.saveCampaignAction(fd({ label: `Camp ${++n}`, kind: "ads", status: "live" })))],
    ["addCampaignCostAction", ["owner", "finance"], async () => {
      const [g] = await db.insert(s.campaigns).values({ label: `Cost camp ${++n}` }).returning();
      return strict(() => A.addCampaignCostAction(fd({ campaignId: g.id, entry: "Ads", amountEgp: "1,500", status: "paid", date: "" })));
    }],
    ["saveFormAction", ["owner", "sales"], () => strict(() => A.saveFormAction(fd({ slug: `form-${++n}`, title: "Apply", askEmail: "on", active: "on" })))],
    ["changePasswordAction (wrong current: refused, but reachable)", ROLES, () => A.changePasswordAction(fd({ current: "wrong", next: "a long new password", confirm: "a long new password" }))],
  ];

  for (const [name, allowed, run] of matrix) {
    it(`${name}: allowed for ${allowed.join(", ")}; refused for the others`, async () => {
      for (const role of ROLES) {
        await signInAs(email(role));
        const out = await attempt(run);
        if (allowed.includes(role)) {
          // reaching the end (a value, or a redirect that is not the sign-in page) means the role was let in and it worked
          const worked = out.kind === "ok" || (out.kind === "redirect" && !out.url.startsWith("/login"));
          expect(worked, `${role} should be allowed to ${name}, got ${JSON.stringify(out)}`).toBe(true);
        } else {
          expect(out.kind, `${role} must be refused ${name}`).toBe("forbidden");
        }
      }
    });
  }

  it("nobody signed in is sent to the login page for every action", async () => {
    await signInAs(null);
    for (const [name, , run] of matrix) {
      const out = await attempt(run);
      expect(out, name).toEqual({ kind: "redirect", url: "/login" });
    }
  });

  it("refused actions change nothing", async () => {
    const count = async (t: string) => (await client.unsafe(`select count(*)::int as n from ${t}`))[0].n as number;
    const victim = await freshLead();
    const before = { act: await count("activities"), users: await count("users"), cohorts: await count("cohorts"), stageEv: await count("stage_events") };

    const tasksBefore = await count("tasks");
    await signInAs(email("viewer"));
    await attempt(() => A.createTaskAction(fd({ title: "Nope", back: "/tasks" })));
    expect(await count("tasks")).toBe(tasksBefore);
    await attempt(() => A.addActivity(fd({ id: victim, type: "note", direction: "internal", body: "x" })));
    await attempt(() => A.moveLead({ leadId: victim, stage: "contacted" }));
    await signInAs(email("finance"));
    await attempt(() => A.moveLead({ leadId: victim, stage: "contacted" }));
    await signInAs(email("sales"));
    await attempt(() => A.deleteLeadAction(fd({ id: victim })));
    await attempt(() => A.createUserAction(fd({ name: "X", email: "x@roles.local", role: "owner", password: "long enough pw" })));
    await attempt(() => A.createCohortAction(fd({ name: "Nope", seatCap: 5 })));

    expect(await count("activities")).toBe(before.act);
    expect(await count("users")).toBe(before.users);
    expect(await count("cohorts")).toBe(before.cohorts);
    expect(await count("stage_events")).toBe(before.stageEv);
    const [v] = await db.select().from(s.leads).where(eq(s.leads.id, victim));
    expect(v).toMatchObject({ stage: "new", deletedAt: null });
  });

  it("only owners can override a full cohort; the flag is ignored for sales", async () => {
    const [c] = await db.insert(s.cohorts).values({ name: "Tiny", seatCap: 1 }).returning();
    const [a, b] = [await freshLead(), await freshLead()];
    await signInAs(email("sales"));
    expect((await A.enrolAction({ leadId: a, cohortId: c.id, tier: "foundation", amountEgp: 7500 })).ok).toBe(true);
    const sales = await A.enrolAction({ leadId: b, cohortId: c.id, tier: "foundation", amountEgp: 7500, overrideCap: true });
    expect(sales).toMatchObject({ ok: false, cohortFull: true });
    await signInAs(email("owner"));
    expect((await A.enrolAction({ leadId: b, cohortId: c.id, tier: "foundation", amountEgp: 7500, overrideCap: true })).ok).toBe(true);
  });

  it("the role comes from the database on every call, not from the cookie", async () => {
    const [u] = await db.select().from(s.users).where(eq(s.users.email, email("sales")));
    await signInAs(email("sales")); // cookie says sales
    expect((await attempt(() => A.addActivity(fd({ id: leadId, type: "note", direction: "internal", body: "ok" })))).kind).toBe("ok");
    await updateUser(db, u.id, { role: "viewer" }, null);
    expect((await attempt(() => A.addActivity(fd({ id: leadId, type: "note", direction: "internal", body: "no" })))).kind).toBe("forbidden");
    await updateUser(db, u.id, { role: "sales" }, null);
  });

  it("a stale cookie is rejected: deactivated user, or password changed since sign-in", async () => {
    const [u] = await db.select().from(s.users).where(eq(s.users.email, email("sales")));
    await signInAs(email("sales"));
    await updateUser(db, u.id, { active: false }, null);
    expect(await attempt(() => A.moveLead({ leadId, stage: "replied" }))).toEqual({ kind: "redirect", url: "/login" });
    await updateUser(db, u.id, { active: true }, null);
    expect((await attempt(() => A.moveLead({ leadId, stage: "replied" }))).kind).toBe("ok"); // same cookie works again

    await resetPassword(db, u.id, "reset by the owner", null);
    expect(await attempt(() => A.moveLead({ leadId, stage: "consult_booked" }))).toEqual({ kind: "redirect", url: "/login" });
    await signInAs(email("sales")); // a fresh sign-in carries the new fingerprint
    expect((await attempt(() => A.moveLead({ leadId, stage: "consult_booked" }))).kind).toBe("ok");
  });

  it("route handlers: lead export is owners only; cohort (revenue) export is owner/finance only; both audited", async () => {
    const leadExport = (await import("@/app/(app)/leads/export/route")).GET;
    const cohortExport = (await import("@/app/(app)/cohorts/[id]/export/route")).GET;
    const req = () => new NextRequest("http://localhost/leads/export");

    await signInAs(null);
    expect((await leadExport(req())).status).toBe(401);
    expect((await cohortExport(req(), { params: Promise.resolve({ id: String(cohortId) }) })).status).toBe(401);

    const expected: Record<string, number> = { owner: 200, finance: 200, sales: 403, viewer: 403 };
    for (const role of ROLES) {
      await signInAs(email(role));
      expect((await leadExport(req())).status, `lead export as ${role}`).toBe(role === "owner" ? 200 : 403);
      const res = await cohortExport(req(), { params: Promise.resolve({ id: String(cohortId) }) });
      expect(res.status, `cohort export as ${role}`).toBe(expected[role]);
      if (res.status === 200) {
        expect(res.headers.get("content-type")).toContain("text/csv");
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
    await signInAs(email("owner"));
    expect((await cohortExport(req(), { params: Promise.resolve({ id: "99999" }) })).status).toBe(404);
    expect((await client`select count(*)::int as n from audit_log where action = 'export'`)[0].n).toBeGreaterThanOrEqual(3);
  });

  it("file downloads: signed in and able to read leads; only raster images open inline; every download audited", async () => {
    const route = (await import("@/app/(app)/files/[id]/route")).GET;
    const [png] = await db.insert(s.attachments).values({ fileName: "photo.png", contentType: "image/png", size: 3, sha256: "x", data: Buffer.from("png"), leadId }).returning();
    const [htm] = await db.insert(s.attachments).values({ fileName: "حالة.pdf", contentType: "application/pdf", size: 3, sha256: "x", data: Buffer.from("pdf"), leadId }).returning();
    const get = (id: number | string) => route(new NextRequest(`http://localhost/files/${id}`), { params: Promise.resolve({ id: String(id) }) });
    await signInAs(null);
    expect((await get(png.id)).status).toBe(401);
    for (const role of ROLES) {
      await signInAs(email(role));
      expect((await get(png.id)).status, role).toBe(200);
    }
    let res = await get(png.id);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    res = await get(htm.id);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain(`attachment; filename="____.pdf"; filename*=UTF-8''${encodeURIComponent("حالة.pdf")}`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("pdf");
    expect((await get("abc")).status).toBe(404);
    expect((await get(999999)).status).toBe(404);
  });

  it("two people adding the same phone at once: one wins, the other gets the duplicate, nobody gets a database error", async () => {
    const phone = "01199990001";
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => createLead(db, { fullName: `Racer ${i}`, phone }, null)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((r) => !r.ok)) expect(r).toMatchObject({ ok: false, error: "duplicate" });
    expect((await client`select count(*)::int as n from leads where phone_whatsapp = '+201199990001'`)[0].n).toBe(1);
  });
});
