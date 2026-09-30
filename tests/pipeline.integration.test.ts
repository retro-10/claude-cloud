import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { enrolLead, seatsUsed } from "@/lib/enrol";
import { changeStage, createLead } from "@/lib/leads";
import { getBoard } from "@/lib/pipeline";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("pipeline and enrolment", () => {
  const client = postgres(url ?? "postgres://x", { max: 6, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number;
  let phoneSeq = 0;
  const mk = async (name = "Lead") => {
    const r = await createLead(db, { fullName: `${name} ${++phoneSeq}`, phone: `0101000${String(phoneSeq).padStart(4, "0")}` }, userId);
    if (!r.ok) throw new Error("setup");
    return r.lead;
  };
  const cohort = async (cap: number) => (await db.insert(s.cohorts).values({ name: `C${cap}`, seatCap: cap }).returning())[0];
  const events = (id: number) => db.select().from(s.stageEvents).where(eq(s.stageEvents.leadId, id)).orderBy(s.stageEvents.id);

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  afterAll(() => client.end());

  it("seed creates a placeholder cohort", async () => {
    expect((await db.select().from(s.cohorts)).map((c) => c.name)).toContain("Demo cohort");
  });

  it("enrolling records the enrolment, moves the lead to enrolled and writes a stage event", async () => {
    const lead = await mk();
    const c = await cohort(10);
    const r = await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "freelance_ready", amountEgp: 15000 }, userId);
    expect(r).toMatchObject({ ok: true, seatsUsed: 1, seatCap: 10 });
    const [l] = await db.select().from(s.leads).where(eq(s.leads.id, lead.id));
    expect(l.stage).toBe("enrolled");
    expect(l.closedAt).not.toBeNull();
    expect((await events(lead.id)).map((e) => e.toStage)).toEqual(["new", "enrolled"]);
    const [en] = await db.select().from(s.enrolments).where(eq(s.enrolments.leadId, lead.id));
    expect(en).toMatchObject({ tier: "freelance_ready", amountEgp: 15000, cohortId: c.id });
  });

  it("enrolling a lost lead works and clears its lost reason", async () => {
    const lead = await mk();
    const [reason] = await db.select().from(s.lostReasons).limit(1);
    await changeStage(db, lead.id, "lost", userId, { lostReasonId: reason.id });
    const c = await cohort(10);
    expect((await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).ok).toBe(true);
    const [l] = await db.select().from(s.leads).where(eq(s.leads.id, lead.id));
    expect(l).toMatchObject({ stage: "enrolled", lostReasonId: null });
  });

  it("rejects duplicate enrolment, bad amounts and unknown ids without side effects", async () => {
    const lead = await mk();
    const c = await cohort(10);
    expect(await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 0 }, userId)).toEqual({ ok: false, error: "invalid_amount" });
    expect(await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 75.5 }, userId)).toEqual({ ok: false, error: "invalid_amount" });
    expect(await enrolLead(db, { leadId: lead.id, cohortId: 99999, tier: "foundation", amountEgp: 7500 }, userId)).toEqual({ ok: false, error: "not_found" });
    expect((await db.select().from(s.leads).where(eq(s.leads.id, lead.id)))[0].stage).toBe("new");

    await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).toEqual({ ok: false, error: "already_enrolled" });
  });

  it("seat cap blocks the extra enrolment unless overridden", async () => {
    const c = await cohort(2);
    const [a, b, x] = [await mk(), await mk(), await mk()];
    expect((await enrolLead(db, { leadId: a.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).ok).toBe(true);
    expect((await enrolLead(db, { leadId: b.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId)).ok).toBe(true);
    const blocked = await enrolLead(db, { leadId: x.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(blocked).toEqual({ ok: false, error: "cohort_full", seatsUsed: 2, seatCap: 2 });
    expect(await seatsUsed(db, c.id)).toBe(2);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, x.id)))[0].stage).toBe("new"); // untouched

    const forced = await enrolLead(db, { leadId: x.id, cohortId: c.id, tier: "foundation", amountEgp: 7500, overrideCap: true }, userId);
    expect(forced).toMatchObject({ ok: true, seatsUsed: 3 });
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "create_over_cap"));
    expect(audits).toHaveLength(1);
  });

  it("two simultaneous enrolments cannot both take the last seat", async () => {
    const c = await cohort(1);
    const [a, b] = [await mk(), await mk()];
    const res = await Promise.all([
      enrolLead(db, { leadId: a.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId),
      enrolLead(db, { leadId: b.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId),
    ]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(await seatsUsed(db, c.id)).toBe(1);
  });

  it("won can only be reached through an enrolment, and cannot be left", async () => {
    const lead = await mk();
    expect(await changeStage(db, lead.id, "enrolled", userId)).toMatchObject({ ok: false });
    const c = await cohort(5);
    await enrolLead(db, { leadId: lead.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(await changeStage(db, lead.id, "nurture", userId)).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be moved back/) });
    expect((await db.select().from(s.leads).where(eq(s.leads.id, lead.id)))[0].stage).toBe("enrolled");
  });

  it("every board move writes exactly one stage_event with the right from/to", async () => {
    const lead = await mk();
    for (const st of ["contacted", "replied", "consult_booked", "consult_held", "offer_sent", "nurture"])
      expect(await changeStage(db, lead.id, st, userId)).toEqual({ ok: true });
    expect(await changeStage(db, lead.id, "nurture", userId)).toEqual({ ok: true }); // no-op, no event
    const ev = await events(lead.id);
    expect(ev.map((e) => [e.fromStage, e.toStage])).toEqual([
      [null, "new"], ["new", "contacted"], ["contacted", "replied"], ["replied", "consult_booked"],
      ["consult_booked", "consult_held"], ["consult_held", "offer_sent"], ["offer_sent", "nurture"],
    ]);
  });

  it("board query: totals, days in stage from the last stage event, overdue marker", async () => {
    const lead = await mk("Boardy");
    await changeStage(db, lead.id, "offer_sent", userId);
    // pretend it entered offer_sent 5 days ago
    await client`update stage_events set at = now() - interval '5 days' where lead_id = ${lead.id} and to_stage = 'offer_sent'`;
    await db.insert(s.followUps).values({ leadId: lead.id, dueAt: new Date(Date.now() - 2 * 86_400_000), createdBy: userId });
    await db.insert(s.followUps).values({ leadId: lead.id, dueAt: new Date(Date.now() + 86_400_000), createdBy: userId });

    const board = await getBoard(db);
    const card = board.cards.find((c) => c.id === lead.id)!;
    expect(card.stage).toBe("offer_sent");
    expect(card.daysInStage).toBe(5);
    expect(card.overdue).toBe(true); // earliest open follow-up is in the past
    expect(board.totals.offer_sent).toBeGreaterThanOrEqual(1);

    // deleted leads are not on the board
    await client`update leads set deleted_at = now() where id = ${lead.id}`;
    expect((await getBoard(db)).cards.some((c) => c.id === lead.id)).toBe(false);
  });
});
