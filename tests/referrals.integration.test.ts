import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createCohort } from "@/lib/cohorts";
import { enrolLead } from "@/lib/enrol";
import { intake } from "@/lib/lead-forms";
import { createLead } from "@/lib/leads";
import { mergeLeads } from "@/lib/merge";
import { decideReward, ensureReferralCode, listReferrers, listRewards, referrerByCode, setReferrer, syncRewards } from "@/lib/referrals";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("referrals", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, hana: number, cohortId: number, code: string;
  const lead = async (name: string, phone: string) => {
    const l = await createLead(db, { fullName: name, phone }, userId);
    if (!l.ok) throw new Error("setup");
    return l.lead.id;
  };

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "r".repeat(48);
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
    hana = await lead("Hana Mostafa", "01077700001");
    cohortId = (await createCohort(db, { name: "B", seatCap: 40 }, userId)).id;
  });
  afterAll(() => client.end());

  it("a code is made once from the first name, and leads to its owner", async () => {
    code = (await ensureReferralCode(db, hana))!;
    expect(code).toMatch(/^hana-[a-z2-9]{4}$/);
    expect(await ensureReferralCode(db, hana)).toBe(code);
    expect(await referrerByCode(db, code.toUpperCase())).toBe(hana);
    expect(await referrerByCode(db, "nope-0000")).toBeNull();
    expect(await referrerByCode(db, "'; drop table leads; --")).toBeNull();
  });

  it("signing up through ?ref= marks the new lead as referred; an existing lead is not re-attributed", async () => {
    const r = await intake(db, { name: "Omar", phone: "01077700002", consent: true, attribution: { ref: code }, channel: "form" });
    if (!r.ok) throw new Error(r.error);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, r.leadId)))[0].referredById).toBe(hana);
    const known = await lead("Known Person", "01077700003");
    await intake(db, { name: "Known", phone: "01077700003", consent: true, attribution: { ref: code }, channel: "form" });
    expect((await db.select().from(s.leads).where(eq(s.leads.id, known)))[0].referredById).toBeNull();
  });

  it("referrer by hand: never yourself, never both ways", async () => {
    const omar = (await db.select().from(s.leads).where(eq(s.leads.fullName, "Omar")))[0].id;
    expect(await setReferrer(db, hana, hana, userId)).toEqual({ ok: false, error: "Someone cannot refer themselves" });
    expect(await setReferrer(db, hana, omar, userId)).toMatchObject({ ok: false });
    const known = (await db.select().from(s.leads).where(eq(s.leads.fullName, "Known Person")))[0].id;
    expect(await setReferrer(db, known, hana, userId)).toEqual({ ok: true });
    expect(await listReferrers(db)).toMatchObject([{ id: hana, referred: 2, enrolled: 0 }]);
  });

  it("enrolling makes a reward to decide; approving needs an amount; paid goes to the ledger once", async () => {
    const omar = (await db.select().from(s.leads).where(eq(s.leads.fullName, "Omar")))[0].id;
    const e = await enrolLead(db, { leadId: omar, cohortId, tier: "foundation", amountEgp: 7500, paymentRef: "X" }, userId);
    if (!e.ok) throw new Error(e.error);
    await syncRewards(db);
    await syncRewards(db); // safe to repeat
    const [w] = await listRewards(db);
    expect(w).toMatchObject({ referrer: "Hana Mostafa", referred: "Omar", w: { status: "pending", amountEgp: null } });
    expect(await decideReward(db, w.w.id, { status: "approved" }, userId)).toEqual({ ok: false, error: "Set the amount (EGP) to approve or pay a reward" });
    expect(await decideReward(db, w.w.id, { status: "approved", amountEgp: 500 }, userId)).toEqual({ ok: true });
    expect(await decideReward(db, w.w.id, { status: "paid" }, userId)).toEqual({ ok: true });
    expect(await decideReward(db, w.w.id, { status: "paid" }, userId)).toEqual({ ok: true });
    const costs = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.category, "Referral rewards"));
    expect(costs).toMatchObject([{ amountEgp: 500, status: "paid", section: "variable_costs" }]);
    expect((await listReferrers(db))[0]).toMatchObject({ enrolled: 1, paidEgp: 500 });
  });

  it("merging the referrer into another lead keeps the referrals and the code", async () => {
    const twin = await lead("Hana M.", "01077700009");
    const m = await mergeLeads(db, { survivorId: twin, loserId: hana, pick: {} }, userId);
    if (!m.ok) throw new Error(m.error);
    expect(await referrerByCode(db, code)).toBe(twin);
    expect((await listReferrers(db)).map((r) => r.id)).toEqual([twin]);
    expect((await listRewards(db))[0].w.referrerId).toBe(twin);
  });
});
