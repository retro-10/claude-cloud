import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { campaignCosts, campaignStats, saveCampaign, slugify } from "@/lib/campaigns";
import { createCohort } from "@/lib/cohorts";
import { enrolLead } from "@/lib/enrol";
import { saveEntry } from "@/lib/finance";
import { createLead } from "@/lib/leads";
import { deleteCampaign } from "@/lib/settings";
import { withoutRelease11Rules } from "./base-rules";

describe("link names", () => {
  it("are lowercase ascii with dashes", () => {
    expect(slugify("Masterclass, October 2026!")).toBe("masterclass-october-2026");
    expect(slugify("  --Ads -- Week 1--")).toBe("ads-week-1");
    expect(slugify("ماستر كلاس")).toBe("");
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("campaign tracker", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, campaignId: number, otherId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    userId = (await db.select().from(s.users))[0].id;
  });
  afterAll(() => client.end());

  it("creates and edits campaigns; link names are checked and unique", async () => {
    const a = await saveCampaign(db, null, { label: "Masterclass Oct", kind: "masterclass", status: "live", slug: "mc-oct", budgetEgp: 20000 }, userId);
    if (!a.ok) throw new Error(a.error);
    campaignId = a.id;
    const b = await saveCampaign(db, null, { label: "Ads week 1", kind: "ads", status: "live" }, userId);
    if (!b.ok) throw new Error(b.error);
    otherId = b.id;
    expect(await saveCampaign(db, otherId, { label: "Ads week 1", kind: "ads", status: "live", slug: "MC-OCT" }, userId)).toEqual({ ok: false, error: 'The link name "mc-oct" is used by another campaign' });
    expect(await saveCampaign(db, otherId, { label: "Ads", kind: "ads", status: "live", slug: "bad slug!" }, userId)).toMatchObject({ ok: false });
    expect(await saveCampaign(db, otherId, { label: "", kind: "ads", status: "live" }, userId)).toMatchObject({ ok: false });
    expect(await saveCampaign(db, campaignId, { label: "Masterclass October", kind: "masterclass", status: "live", slug: "mc-oct", budgetEgp: 20000 }, userId)).toMatchObject({ ok: true });
  });

  it("counts leads, consults and enrolments, and spends only Paid tagged costs", async () => {
    const cohortId = (await createCohort(db, { name: "B1", seatCap: 40 }, userId)).id;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const l = await createLead(db, { fullName: `C${i}`, phone: `0104444000${i}`, campaignId }, userId);
      if (!l.ok) throw new Error("setup");
      ids.push(l.lead.id);
    }
    await db.insert(s.consults).values([0, 1].map((i) => ({ leadId: ids[i], scheduledAt: new Date(), held: true })));
    const e = await enrolLead(db, { leadId: ids[0], cohortId, tier: "foundation", amountEgp: 7500, paymentRef: "X" }, userId);
    if (!e.ok) throw new Error(e.error);
    await saveEntry(db, null, { entry: "IG ads", amountEgp: 2000, section: "variable_costs", category: "Ads & promotion", status: "paid", campaignId }, userId);
    await saveEntry(db, null, { entry: "Studio", amountEgp: 1000, section: "variable_costs", category: "Equipment", status: "owed", campaignId }, userId);
    expect(await saveEntry(db, null, { entry: "x", amountEgp: 5, section: "income", category: "Refund", status: "received", campaignId }, userId)).toEqual({ ok: false, error: "Only a cost can be tagged to a campaign" });

    const [c] = await campaignStats(db, campaignId);
    expect(c).toMatchObject({ leads: 4, consulted: 2, enrolled: 1, revenueEgp: 7500, spendEgp: 2000, owedEgp: 1000, costPerLead: 500, costPerEnrolment: 2000, roi: 2.75 });
    expect((await campaignStats(db)).map((r) => r.id)).toEqual(expect.arrayContaining([campaignId, otherId]));
    expect((await campaignCosts(db, campaignId)).map((x) => x.entry).sort()).toEqual(["IG ads", "Studio"]);
  });

  it("editing a cost elsewhere keeps its campaign tag; a tagged campaign cannot be deleted", async () => {
    const [cost] = (await campaignCosts(db, campaignId)).filter((x) => x.entry === "IG ads");
    await saveEntry(db, cost.id, { entry: "IG ads, week 1", amountEgp: 2000, section: "variable_costs", category: "Ads & promotion", status: "paid" }, userId);
    expect((await campaignCosts(db, campaignId)).map((x) => x.entry)).toContain("IG ads, week 1");
    await saveEntry(db, null, { entry: "Ad", amountEgp: 10, section: "variable_costs", category: "Ads & promotion", status: "paid", campaignId: otherId }, userId);
    expect(await deleteCampaign(db, otherId, userId)).toEqual({ ok: false, error: "1 cost is tagged to it; rename it instead" });
  });
});
