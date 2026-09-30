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

    expect((await demoCounts(db)).leads).toBe(20);
    const r = await removeDemoData(db, null);
    expect(r.leads).toBe(20);
    expect(await demoCounts(db)).toEqual({ leads: 0, ledger: 0 });
    expect(await db.select().from(s.leads).where(like(s.leads.fullName, "Demo Lead%"))).toHaveLength(0);
    expect(await db.select().from(s.cohorts).where(like(s.cohorts.name, "Demo Cohort%"))).toHaveLength(0);
    expect(await db.select().from(s.proofItems)).toHaveLength(0);

    expect(await db.select().from(s.leads).where(eq(s.leads.id, real.id))).toHaveLength(1);
    expect(await db.select().from(s.cohorts).where(eq(s.cohorts.id, batch.id))).toHaveLength(1);
    expect(await db.select().from(s.ledgerEntries)).toMatchObject([{ entry: "Real — payment" }]);
    // running it again is harmless
    expect((await removeDemoData(db, null)).leads).toBe(0);
  });
});
