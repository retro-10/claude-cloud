import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createCohort, listCohorts } from "@/lib/cohorts";
import { enrolLead } from "@/lib/enrol";
import { financeBoard, listCandidates, recordPayment, updateCandidate } from "@/lib/finance";
import { createLead } from "@/lib/leads";
import { getMetrics } from "@/lib/metrics";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Owner's answer to open question 10: a dropped student stops owing, and revenue counts only what they kept paid.
d("a dropped student", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let cohortId: number, enrolmentId: number, otherId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    await client.unsafe("delete from cohorts");
    cohortId = (await createCohort(db, { name: "Batch 1", seatCap: 40, status: "live" }, null)).id;
    const enrol = async (name: string, phone: string) => {
      const l = await createLead(db, { fullName: name, phone }, null);
      if (!l.ok) throw new Error("setup");
      const e = await enrolLead(db, { leadId: l.lead.id, cohortId, tier: "freelance_ready", amountEgp: 15000, paymentPlan: "installments", paidAmountEgp: 5000, paymentRef: "P" }, null);
      if (!e.ok) throw new Error("enrol " + e.error);
      return (await listCandidates(db, { leadId: l.lead.id }))[0].enrolmentId;
    };
    enrolmentId = await enrol("Leaves Early", "01000000001");
    otherId = await enrol("Stays On", "01000000002");
  });
  afterAll(() => client.end());

  it("owes nothing more, open instalments are cancelled, and revenue keeps only the money paid", async () => {
    const before = (await listCandidates(db, { enrolmentId }))[0];
    expect(before).toMatchObject({ due: 15000, paid: 5000, remaining: 10000, expected: 10000 });
    expect((await listCohorts(db))[0].revenueEgp).toBe(30000);

    expect(await updateCandidate(db, enrolmentId, { status: "dropped" }, null)).toEqual({ ok: true });

    const after = (await listCandidates(db, { enrolmentId }))[0];
    expect(after).toMatchObject({ status: "dropped", due: 5000, paid: 5000, remaining: 0, expected: 0, nextDue: null });
    const open = await db.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.enrolmentId, enrolmentId), eq(s.ledgerEntries.status, "expected")));
    expect(open).toHaveLength(0);
    // the payment already received stays in the books
    const kept = await db.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.enrolmentId, enrolmentId), eq(s.ledgerEntries.status, "received")));
    expect(kept.map((r) => r.amountEgp)).toEqual([5000]);

    // the other student is untouched; batch, dashboard and books all agree
    expect((await listCandidates(db, { enrolmentId: otherId }))[0]).toMatchObject({ due: 15000, remaining: 10000 });
    expect((await listCohorts(db))[0].revenueEgp).toBe(20000);
    expect((await getMetrics(db)).revenue.totalEgp).toBe(20000);
    const board = await financeBoard(db);
    expect(board.candidates).toMatchObject({ due: 20000, remaining: 10000 });
    expect(board.comingUp.some((r) => r.enrolmentId === enrolmentId)).toBe(false);
  });

  it("a refund lowers what a dropped student counts for, never below zero", async () => {
    await recordPayment(db, { enrolmentId, amountEgp: 5000, entry: "Refund", status: "received" }, null);
    await client`update ledger_entries set category = 'Refund' where entry = 'Refund'`;
    expect((await listCandidates(db, { enrolmentId }))[0]).toMatchObject({ due: 0, paid: 0, remaining: 0 });
    expect((await getMetrics(db)).revenue.totalEgp).toBe(15000);
  });
});
