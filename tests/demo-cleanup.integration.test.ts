import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedDemoIfEmpty, seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { demoCounts, removeDemoData } from "@/lib/demo-cleanup";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("removing the demo data", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    expect(await seedDemoIfEmpty(url)).toBe(true);
  });
  afterAll(() => client.end());

  it("deletes every demo lead, batch and DEMO money row, and nothing real", async () => {
    // a real lead, batch and payment added after the demo
    const [real] = await db.insert(s.leads).values({ fullName: "Real Person", phoneWhatsapp: "+201099887766", stage: "enrolled" }).returning();
    const [batch] = await db.insert(s.cohorts).values({ name: "Batch 1", seatCap: 40 }).returning();
    const [e] = await db.insert(s.enrolments).values({ leadId: real.id, cohortId: batch.id, tier: "foundation", amountEgp: 7500 }).returning();
    await db.insert(s.ledgerEntries).values({ entry: "Real — payment", amountEgp: 7500, section: "income", category: "Candidate payment", status: "received", enrolmentId: e.id });
    // a real client whose case uses a demo price; and the designer pay of a demo case (named like any real one)
    const [crown] = await db.select().from(s.caseTypes).where(eq(s.caseTypes.name, "DEMO Crown"));
    const [realClient] = await db.insert(s.productionClients).values({ name: "Real Clinic" }).returning();
    await db.insert(s.productionCases).values({ clientId: realClient.id, caseTypeId: crown.id, dueAt: new Date(), priceEgp: 900 });
    const [demoCase] = await db.select().from(s.productionCases).where(eq(s.productionCases.status, "delivered"));
    await db.insert(s.ledgerEntries).values({ entry: "PC-0004 design — Badr", amountEgp: 350, section: "variable_costs", category: "Production designers", status: "owed", caseId: demoCase.id });
    await db.insert(s.attachments).values({ fileName: "crown.stl", contentType: "model/stl", size: 1, sha256: "x", data: Buffer.from("x"), caseId: demoCase.id });

    // demo rows already mirrored to Notion, and a real lead that is too
    const [demoLead] = await db.select().from(s.leads).where(eq(s.leads.fullName, "Demo Lead 01"));
    const [demoMoney] = await db.select().from(s.ledgerEntries).where(like(s.ledgerEntries.entry, "DEMO %")).limit(1);
    await db.insert(s.notionLinks).values([
      { entity: "lead", localId: demoLead.id, pageId: "page-demo-lead", hash: "h", syncedAt: new Date() },
      { entity: "ledger", localId: demoMoney.id, pageId: "page-demo-money", hash: "h", syncedAt: new Date() },
      { entity: "lead", localId: real.id, pageId: "page-real-lead", hash: "h", syncedAt: new Date() },
    ]);

    expect((await demoCounts(db)).leads).toBe(20);
    const r = await removeDemoData(db, null);
    expect(r.leads).toBe(20);
    // the Notion pages are handed back to be archived, and their links stay as "gone" so a later read of
    // Notion never brings the demo rows back as new ones
    expect(r.notionPages.sort()).toEqual(["page-demo-lead", "page-demo-money"]);
    const links = await db.select().from(s.notionLinks);
    expect(links.find((l) => l.pageId === "page-demo-lead")?.hash).toBe("gone");
    expect(links.find((l) => l.pageId === "page-demo-money")?.hash).toBe("gone");
    expect(links.find((l) => l.pageId === "page-real-lead")?.hash).toBe("h");
    expect(await demoCounts(db)).toEqual({ leads: 0, ledger: 0 });
    expect(await db.select().from(s.leads).where(like(s.leads.fullName, "Demo Lead%"))).toHaveLength(0);
    expect(await db.select().from(s.cohorts).where(like(s.cohorts.name, "Demo Cohort%"))).toHaveLength(0);
    expect(await db.select().from(s.proofItems)).toHaveLength(0);
    // the production demo: clients, price list, cases (and nothing a real client uses)
    expect(await db.select().from(s.productionClients)).toEqual([expect.objectContaining({ name: "Real Clinic" })]);
    expect(await db.select().from(s.productionCases)).toHaveLength(1);
    expect((await db.select().from(s.caseTypes)).map((t) => t.name).sort()).toEqual(["DEMO Crown"]); // still used by the real case

    expect(await db.select().from(s.leads).where(eq(s.leads.id, real.id))).toHaveLength(1);
    expect(await db.select().from(s.cohorts).where(eq(s.cohorts.id, batch.id))).toHaveLength(1);
    expect(await db.select().from(s.ledgerEntries)).toMatchObject([{ entry: "Real — payment" }]);
    // running it again is harmless
    expect((await removeDemoData(db, null)).leads).toBe(0);
  });
});
