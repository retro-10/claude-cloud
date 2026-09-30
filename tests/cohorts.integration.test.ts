import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createCohort, getCohort, listCohorts, updateCohort, updateEnrolmentPayment } from "@/lib/cohorts";
import { bookConsult, consultObjectionIds, markConsult, rescheduleConsult } from "@/lib/consults";
import { enrolLead, seatsUsed } from "@/lib/enrol";
import { changeStage, createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("consults, cohorts, payments", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, seq = 0;
  const mk = async () => {
    const r = await createLead(db, { fullName: `C${++seq}`, phone: `0103000${String(seq).padStart(4, "0")}` }, userId);
    if (!r.ok) throw new Error("setup");
    return r.lead;
  };
  const stage = async (id: number) => (await db.select().from(s.leads).where(eq(s.leads.id, id)))[0].stage;
  const objection = async (label: string) => (await db.select().from(s.objections).where(eq(s.objections.label, label)))[0].id;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  afterAll(() => client.end());

  it("booking a consult moves an early lead to consult_booked, and never backwards", async () => {
    const a = await mk();
    const c = await bookConsult(db, { leadId: a.id, scheduledAt: new Date("2026-10-01T10:00:00Z") }, userId);
    expect(c).not.toBeNull();
    expect(await stage(a.id)).toBe("consult_booked");

    const b = await mk();
    await changeStage(db, b.id, "offer_sent", userId);
    await bookConsult(db, { leadId: b.id, scheduledAt: new Date("2026-10-02T10:00:00Z") }, userId);
    expect(await stage(b.id)).toBe("offer_sent"); // already further along: untouched

    const n = await mk();
    await changeStage(db, n.id, "nurture", userId);
    await bookConsult(db, { leadId: n.id, scheduledAt: new Date("2026-10-03T10:00:00Z") }, userId);
    expect(await stage(n.id)).toBe("nurture"); // nurture stays a deliberate manual decision

    expect(await bookConsult(db, { leadId: 99999, scheduledAt: new Date() }, userId)).toBeNull();
  });

  it("marking held records outcome + objection tags, logs an activity and advances to consult_held", async () => {
    const lead = await mk();
    const c = (await bookConsult(db, { leadId: lead.id, scheduledAt: new Date("2026-10-01T10:00:00Z") }, userId))!;
    const price = await objection("Price"), trust = await objection("Trust");

    expect(await markConsult(db, { consultId: c.id, result: "held" }, userId)).toMatchObject({ ok: false }); // outcome required
    expect(await markConsult(db, { consultId: c.id, result: "held", outcome: "no_show" as never }, userId)).toMatchObject({ ok: false });

    const r = await markConsult(db, { consultId: c.id, result: "held", outcome: "thinking", objectionIds: [price, trust, price], notes: "wants a discount" }, userId);
    expect(r).toEqual({ ok: true });
    const [row] = await db.select().from(s.consults).where(eq(s.consults.id, c.id));
    expect(row).toMatchObject({ held: true, outcome: "thinking", notes: "wants a discount" });
    expect((await consultObjectionIds(db, [c.id])).get(c.id)!.sort()).toEqual([price, trust].sort()); // deduped
    expect(await stage(lead.id)).toBe("consult_held");
    const acts = await db.select().from(s.activities).where(eq(s.activities.leadId, lead.id));
    expect(acts.some((a) => a.type === "consult" && /held: thinking/.test(a.body ?? ""))).toBe(true);
    // consult activities are internal: they must not count as first contact
    expect((await db.select().from(s.leads).where(eq(s.leads.id, lead.id)))[0].firstContactAt).toBeNull();

    // re-marking replaces the tags
    await markConsult(db, { consultId: c.id, result: "held", outcome: "enrolled", objectionIds: [] }, userId);
    expect((await consultObjectionIds(db, [c.id])).get(c.id)).toBeUndefined();
  });

  it("no-show sets outcome no_show, held=false, clears tags, keeps the stage", async () => {
    const lead = await mk();
    const c = (await bookConsult(db, { leadId: lead.id, scheduledAt: new Date("2026-10-01T10:00:00Z") }, userId))!;
    await markConsult(db, { consultId: c.id, result: "no_show", objectionIds: [await objection("Time")] }, userId);
    const [row] = await db.select().from(s.consults).where(eq(s.consults.id, c.id));
    expect(row).toMatchObject({ held: false, outcome: "no_show" });
    expect(await consultObjectionIds(db, [c.id])).toEqual(new Map());
    expect(await stage(lead.id)).toBe("consult_booked");
    expect(await rescheduleConsult(db, c.id, new Date("2026-10-09T10:00:00Z"), userId)).toBe(true); // a no-show can be rebooked
  });

  it("cohort revenue totals equal the sum of the enrolment rows, per tier and overall", async () => {
    const c = await createCohort(db, { name: "Rev", seatCap: 10 }, userId);
    const plan: [string, number, boolean][] = [["foundation", 7500, true], ["freelance_ready", 15000, true], ["freelance_ready", 15000, false], ["production_partner", 42000, true]];
    for (const [tier, amount, paid] of plan) {
      const l = await mk();
      const r = await enrolLead(db, { leadId: l.id, cohortId: c.id, tier: tier as never, amountEgp: amount, paidAt: paid ? new Date() : null }, userId);
      expect(r.ok).toBe(true);
    }
    const detail = (await getCohort(db, c.id))!;
    const sumRows = (await db.select().from(s.enrolments).where(eq(s.enrolments.cohortId, c.id))).reduce((t, e) => t + e.amountEgp, 0);
    expect(sumRows).toBe(79500);
    expect(detail.summary).toMatchObject({ seatsUsed: 4, revenueEgp: 79500, collectedEgp: 64500 });
    expect(detail.byTier).toEqual({ foundation: { count: 1, egp: 7500 }, freelance_ready: { count: 2, egp: 30000 }, production_partner: { count: 1, egp: 42000 } });
    expect(detail.students).toHaveLength(4);
    const listed = (await listCohorts(db)).find((x) => x.id === c.id)!;
    expect(listed.revenueEgp).toBe(79500);
    // a cohort with no enrolments shows zeros, not nulls
    const empty = await createCohort(db, { name: "Empty", seatCap: 3 }, userId);
    expect((await listCohorts(db)).find((x) => x.id === empty.id)).toMatchObject({ seatsUsed: 0, revenueEgp: 0, collectedEgp: 0 });
  });

  it("seats used never exceed the cap without override, and the cap cannot be lowered under the seats taken", async () => {
    const c = await createCohort(db, { name: "Cap", seatCap: 2 }, userId);
    const [a, b, x] = [await mk(), await mk(), await mk()];
    await enrolLead(db, { leadId: a.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    await enrolLead(db, { leadId: b.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(await enrolLead(db, { leadId: x.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).toMatchObject({ ok: false, error: "cohort_full" });
    expect(await seatsUsed(db, c.id)).toBe(2);

    expect(await updateCohort(db, c.id, { name: "Cap", seatCap: 1 }, userId)).toMatchObject({ ok: false });
    expect((await db.select().from(s.cohorts).where(eq(s.cohorts.id, c.id)))[0].seatCap).toBe(2);
    expect(await updateCohort(db, c.id, { name: "Cap 2", seatCap: 5, enrolmentCloseAt: new Date("2026-11-01T00:00:00Z") }, userId)).toEqual({ ok: true });
    expect(await enrolLead(db, { leadId: x.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).toMatchObject({ ok: true });
  });

  it("payment edits change only payment fields, validate the amount, and are audited without values", async () => {
    const c = await createCohort(db, { name: "Pay", seatCap: 5 }, userId);
    const l = await mk();
    await enrolLead(db, { leadId: l.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    const [e] = await db.select().from(s.enrolments).where(eq(s.enrolments.leadId, l.id));

    expect(await updateEnrolmentPayment(db, e.id, { amountEgp: 0 }, userId)).toMatchObject({ ok: false });
    expect(await updateEnrolmentPayment(db, 99999, { amountEgp: 100 }, userId)).toMatchObject({ ok: false });
    const paid = new Date("2026-09-20T12:00:00Z");
    expect(await updateEnrolmentPayment(db, e.id, { amountEgp: 7000, paidAt: paid, paymentRef: " PM-123 ", gateway: "paymob" }, userId)).toEqual({ ok: true });
    const [after] = await db.select().from(s.enrolments).where(eq(s.enrolments.id, e.id));
    expect(after).toMatchObject({ amountEgp: 7000, paymentRef: "PM-123", gateway: "paymob", leadId: l.id, cohortId: c.id });
    expect(after.paidAt).toEqual(paid);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "payment_update"));
    expect(JSON.stringify(audits[0].diff)).not.toContain("PM-123");
    expect(await stage(l.id)).toBe("enrolled");
  });
});
