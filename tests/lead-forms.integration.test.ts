import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { resetRateLimit } from "@/lib/rate-limit";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const { env } = vi.hoisted(() => ({ env: { ip: "203.0.113.9" } }));
vi.mock("next/headers", () => ({ headers: () => new Headers({ "x-forwarded-for": env.ip }), cookies: () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

d("public lead forms and the inbound webhook", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let LF: typeof import("@/lib/lead-forms");
  let submit: typeof import("@/app/f/[slug]/actions").submitFormAction;
  let userId: number, formId: number, campaignId: number, adsCampaign: number;
  const leadsCount = async () => (await client`select count(*)::int as n from leads`)[0].n as number;

  beforeAll(async () => {
    process.env.AUTH_SECRET = "f".repeat(48);
    process.env.DATABASE_URL = url;
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    LF = await import("@/lib/lead-forms");
    submit = (await import("@/app/f/[slug]/actions")).submitFormAction;
    userId = (await db.select().from(s.users))[0].id;
    const [mc] = await db.insert(s.campaigns).values({ label: "Masterclass Oct", kind: "masterclass", slug: "mc-oct" }).returning();
    const [ads] = await db.insert(s.campaigns).values({ label: "Ads wk1", kind: "ads", slug: "ads-wk1" }).returning();
    [campaignId, adsCampaign] = [mc.id, ads.id];
  });
  beforeEach(() => resetRateLimit());
  afterAll(() => client.end());

  it("forms: address and title are checked, addresses are unique", async () => {
    const r = await LF.saveForm(db, null, { slug: "mc-oct", title: "Register for the masterclass", campaignId, askEmail: true, askCity: false, askSegment: true, askTier: false, active: true }, userId);
    if (!r.ok) throw new Error(r.error);
    formId = r.id;
    expect(await LF.saveForm(db, null, { slug: "MC-OCT", title: "x", askEmail: true, askCity: false, askSegment: true, askTier: false, active: true }, userId)).toEqual({ ok: false, error: "The address /f/mc-oct is already used" });
    expect((await LF.saveForm(db, null, { slug: "no spaces", title: "x", askEmail: true, askCity: false, askSegment: true, askTier: false, active: true }, userId)).ok).toBe(false);
  });

  it("the signed stamp: a post without the page, or within 2 seconds, or very late, is not accepted", () => {
    const now = Date.now();
    expect(LF.checkStamp(formId, LF.formStamp(formId, now - 5000), now)).toBe("ok");
    expect(LF.checkStamp(formId, LF.formStamp(formId, now - 500), now)).toBe("too_fast");
    expect(LF.checkStamp(formId, LF.formStamp(formId, now - 7 * 3600_000), now)).toBe("expired");
    expect(LF.checkStamp(formId + 1, LF.formStamp(formId, now - 5000), now)).toBe("bad"); // another form's stamp
    expect(LF.checkStamp(formId, `${now - 5000}.forged`, now)).toBe("bad");
    expect(LF.cleanAttribution({ utm_source: " Instagram\u0000 ", utm_evil: "x", ref: "a".repeat(300) })).toEqual({ utm_source: "Instagram", ref: "a".repeat(100) });
  });

  const good = (o: Record<string, string> = {}) =>
    fd({ slug: "mc-oct", t: LF.formStamp(formId, Date.now() - 5000), name: "Hana Ali", phone: "0122 555 0001", email: "", segment: "dentist", consent: "on", utm_source: "instagram", utm_medium: "story", utm_content: "reel-7", ...o });

  it("a person signing up becomes a lead with the form's campaign, the link's tags and WhatsApp consent", async () => {
    expect(await submit({}, good())).toEqual({ done: true });
    const [l] = await db.select().from(s.leads).where(eq(s.leads.phoneWhatsapp, "+201225550001"));
    expect(l).toMatchObject({ fullName: "Hana Ali", campaignId, segment: "dentist", stage: "new" });
    expect(l.attribution).toEqual({ utm_source: "instagram", utm_medium: "story", utm_content: "reel-7", form: String(formId) });
    const consent = await db.select().from(s.consentRecords).where(eq(s.consentRecords.leadId, l.id));
    expect(consent).toMatchObject([{ granted: true, method: "form" }]);
    const [src] = await db.select().from(s.sources).where(eq(s.sources.id, l.sourceId!));
    expect(src.label).toBe("Website form");
  });

  it("the same person again: linked to the lead we have, no duplicate, and the page says the same thing", async () => {
    const before = await leadsCount();
    expect(await submit({}, good({ name: "Hana A.", phone: "+20 122 555 0001" }))).toEqual({ done: true });
    expect(await leadsCount()).toBe(before);
    const subs = await db.select().from(s.formSubmissions).where(eq(s.formSubmissions.formId, formId));
    expect(subs.map((x) => x.existing)).toEqual([false, true]);
    expect(subs[0].ipHash).toMatch(/^[0-9a-f]{24}$/);
    expect(subs[0].ipHash).not.toContain("203");
  });

  it("bots get a thank-you and nothing is saved: honeypot filled, no stamp, too fast", async () => {
    const before = await leadsCount();
    expect(await submit({}, good({ phone: "01225550002", website: "http://spam" }))).toEqual({ done: true });
    expect(await submit({}, good({ phone: "01225550003", t: "" }))).toEqual({ done: true });
    expect(await submit({}, good({ phone: "01225550004", t: LF.formStamp(formId) }))).toEqual({ done: true });
    expect(await leadsCount()).toBe(before);
  });

  it("people get a clear error: no consent, a bad number, a closed form; and 5 sign-ups per address per 10 minutes", async () => {
    expect(await submit({}, good({ phone: "01225550005", consent: "" }))).toMatchObject({ field: "consent" });
    expect(await submit({}, good({ phone: "12" }))).toMatchObject({ field: "phone" });
    expect(await submit({}, good({ slug: "nope" }))).toEqual({ error: "This form is closed." });
    resetRateLimit();
    env.ip = "198.51.100.20";
    for (let i = 0; i < 5; i++) expect(await submit({}, good({ phone: `0100000010${i}` }))).toEqual({ done: true });
    expect(await submit({}, good({ phone: "01000000199" }))).toMatchObject({ error: expect.stringContaining("Too many") });
  });

  it("the webhook: off without a token, refuses a wrong one, takes leads in, and links repeats", async () => {
    const route = (await import("@/app/api/inbound/leads/route")).POST;
    const post = (body: unknown, auth?: string) =>
      route(new NextRequest("http://localhost/api/inbound/leads", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) } }));
    delete process.env.INBOUND_LEADS_TOKEN;
    expect((await post({ name: "A", phone: "01011112222" })).status).toBe(404);
    process.env.INBOUND_LEADS_TOKEN = "t".repeat(32);
    expect((await post({ name: "A", phone: "01011112222" }, "Bearer wrong")).status).toBe(401);
    expect((await post({ name: "A" }, `Bearer ${"t".repeat(32)}`)).status).toBe(400);

    let res = await post({ name: "Ads Person", phone: "01011112222", campaign: "ads-wk1", source: "Instagram ads", consent: true, utm_source: "meta" }, `Bearer ${"t".repeat(32)}`);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [l] = await db.select().from(s.leads).where(eq(s.leads.id, id));
    expect(l).toMatchObject({ campaignId: adsCampaign, attribution: { utm_source: "meta" } });
    const [src] = await db.select().from(s.sources).where(eq(s.sources.id, l.sourceId!));
    expect(src.label).toBe("Instagram ads");
    res = await post({ name: "Ads Person", phone: "+201011112222" }, `Bearer ${"t".repeat(32)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id, existing: true });
    expect((await post({ name: "x", phone: "12" }, `Bearer ${"t".repeat(32)}`)).status).toBe(422);
  });

  it("a link's utm_campaign files the lead under that campaign when the form has none", async () => {
    const r = await LF.intake(db, { name: "Tagged", phone: "01033334444", consent: false, attribution: { utm_campaign: "ADS-WK1" }, channel: "form" });
    if (!r.ok) throw new Error(r.error);
    const [l] = await db.select().from(s.leads).where(eq(s.leads.id, r.leadId));
    expect(l.campaignId).toBe(adsCampaign);
    expect(await db.select().from(s.consentRecords).where(eq(s.consentRecords.leadId, r.leadId))).toHaveLength(0);
  });
});
