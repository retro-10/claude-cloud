import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { bulkAssign, bulkCadence, bulkChangeStage } from "@/lib/bulk";
import { applyCadence, cancelFollowUp, completeFollowUp, createFollowUp, rescheduleFollowUp } from "@/lib/followups";
import { changeStage, createLead, logActivity } from "@/lib/leads";
import { cairoYmd, cairoLocalToDate, startOfCairoDay } from "@/lib/time";
import { getToday } from "@/lib/today";
import { enrolLead } from "@/lib/enrol";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("follow-ups, cadences, stop rules, today", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, outreach: number, postConsult: number, seq = 0;
  const mk = async () => {
    const r = await createLead(db, { fullName: `L${++seq}`, phone: `0102000${String(seq).padStart(4, "0")}` }, userId);
    if (!r.ok) throw new Error("setup");
    return r.lead;
  };
  const open = (leadId: number) =>
    client`select id, template_id from follow_ups where lead_id = ${leadId} and done_at is null and cancelled_at is null order by due_at`;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
    const tpls = await db.select().from(s.cadenceTemplates);
    outreach = tpls.find((t) => t.name.startsWith("Outreach"))!.id;
    postConsult = tpls.find((t) => t.name === "Post-consult")!.id;
  });
  afterAll(() => client.end());

  it("the 14-day outreach cadence creates 6 follow-ups on days 0,1,4,8,12,14 (Cairo dates)", async () => {
    const lead = await mk();
    const start = cairoLocalToDate("2026-10-20T15:30")!; // Cairo, after the DST change (Oct 30 2026 is a Friday)
    const r = await applyCadence(db, { leadId: lead.id, templateId: outreach, start }, userId);
    expect(r).toMatchObject({ ok: true, created: 6 });
    const rows = await db.select().from(s.followUps).where(eq(s.followUps.leadId, lead.id)).orderBy(s.followUps.dueAt);
    expect(rows.map((f) => cairoYmd(f.dueAt))).toEqual([
      "2026-10-20", "2026-10-21", "2026-10-24", "2026-10-28", "2026-11-01", "2026-11-03",
    ]); // crosses the Cairo DST end (Oct 30) and month end without shifting a day
    expect(rows.every((f) => f.templateId === outreach && f.note)).toBe(true);
    expect(rows[1].note).toMatch(/masterclass link/i);
    expect(rows[4].note).toMatch(/deadline/i);
  });

  it("the post-consult cadence creates 4 follow-ups on days 0,2,5,7", async () => {
    const lead = await mk();
    const r = await applyCadence(db, { leadId: lead.id, templateId: postConsult, start: cairoLocalToDate("2026-09-01T10:00")! }, userId);
    expect(r).toMatchObject({ ok: true, created: 4 });
    const rows = await db.select().from(s.followUps).where(eq(s.followUps.leadId, lead.id)).orderBy(s.followUps.dueAt);
    expect(rows.map((f) => cairoYmd(f.dueAt))).toEqual(["2026-09-01", "2026-09-03", "2026-09-06", "2026-09-08"]);
  });

  it("cannot apply the same cadence twice while it is still running, or to closed leads", async () => {
    const lead = await mk();
    await applyCadence(db, { leadId: lead.id, templateId: outreach }, userId);
    expect(await applyCadence(db, { leadId: lead.id, templateId: outreach }, userId)).toEqual({ ok: false, error: "already_applied" });
    expect(await applyCadence(db, { leadId: lead.id, templateId: postConsult }, userId)).toMatchObject({ ok: true }); // a different one is fine
    const [reason] = await db.select().from(s.lostReasons).limit(1);
    const lost = await mk();
    await changeStage(db, lost.id, "lost", userId, { lostReasonId: reason.id });
    expect(await applyCadence(db, { leadId: lost.id, templateId: outreach }, userId)).toEqual({ ok: false, error: "closed" });
    expect(await applyCadence(db, { leadId: 99999, templateId: outreach }, userId)).toEqual({ ok: false, error: "not_found" });
  });

  it("logging an inbound reply cancels the remaining cadence follow-ups but not manual ones or done ones", async () => {
    const lead = await mk();
    await applyCadence(db, { leadId: lead.id, templateId: outreach }, userId);
    await createFollowUp(db, { leadId: lead.id, dueAt: new Date(Date.now() + 86_400_000), note: "manual" }, userId);
    const first = (await open(lead.id))[0];
    await completeFollowUp(db, first.id as number, userId);

    expect(await open(lead.id)).toHaveLength(6); // 5 cadence + 1 manual

    await logActivity(db, { leadId: lead.id, type: "note", direction: "internal", body: "n" }, userId);
    await logActivity(db, { leadId: lead.id, type: "whatsapp", direction: "out" }, userId);
    expect(await open(lead.id)).toHaveLength(6); // notes and outbound do not stop it

    await logActivity(db, { leadId: lead.id, type: "whatsapp", direction: "in", body: "yes I'm interested" }, userId);
    const left = await open(lead.id);
    expect(left).toHaveLength(1);
    expect(left[0].template_id).toBeNull(); // only the manual one survives
    const all = await db.select().from(s.followUps).where(eq(s.followUps.leadId, lead.id));
    expect(all.filter((f) => f.cancelledAt)).toHaveLength(5);
    expect(all.filter((f) => f.doneAt)).toHaveLength(1); // the done one keeps its history
  });

  it("marking a lead lost or enrolled cancels its cadence follow-ups", async () => {
    const [reason] = await db.select().from(s.lostReasons).limit(1);
    const a = await mk();
    await applyCadence(db, { leadId: a.id, templateId: outreach }, userId);
    await changeStage(db, a.id, "lost", userId, { lostReasonId: reason.id });
    expect(await open(a.id)).toHaveLength(0);

    const b = await mk();
    await applyCadence(db, { leadId: b.id, templateId: postConsult }, userId);
    const [c] = await db.insert(s.cohorts).values({ name: "T", seatCap: 5 }).returning();
    await enrolLead(db, { leadId: b.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(await open(b.id)).toHaveLength(0);

    const n = await mk(); // nurture is not a closing stage: cadence keeps running
    await applyCadence(db, { leadId: n.id, templateId: outreach }, userId);
    await changeStage(db, n.id, "nurture", userId);
    expect(await open(n.id)).toHaveLength(6);
  });

  it("done / reschedule / cancel work once and only on open follow-ups", async () => {
    const lead = await mk();
    const f = (await createFollowUp(db, { leadId: lead.id, dueAt: new Date() }, userId))!;
    expect(await rescheduleFollowUp(db, f.id, new Date("2030-01-01T09:00:00Z"), userId)).toBe(true);
    expect(await completeFollowUp(db, f.id, userId)).toBe(true);
    expect(await completeFollowUp(db, f.id, userId)).toBe(false);
    expect(await rescheduleFollowUp(db, f.id, new Date(), userId)).toBe(false);
    expect(await cancelFollowUp(db, f.id, userId)).toBe(false);
    expect(await createFollowUp(db, { leadId: 99999, dueAt: new Date() }, userId)).toBeNull();
  });

  it("Today: buckets by Cairo day, excludes done/cancelled/deleted, orders uncontacted oldest first", async () => {
    await client.unsafe("delete from follow_ups; delete from consults; delete from ledger_entries; delete from programme_sessions; delete from proof_items; delete from enrolments; delete from stage_events; delete from activities; delete from leads;");
    const now = cairoLocalToDate("2026-09-29T14:00")!;
    const today0 = startOfCairoDay(now);
    const at = (h: number) => new Date(today0.getTime() + h * 3600_000);

    const lateNight = await mk(), earlyToday = await mk(), tomorrow = await mk(), yesterday = await mk(), gone = await mk(), done = await mk();
    await db.insert(s.followUps).values([
      { leadId: lateNight.id, dueAt: new Date(today0.getTime() - 60_000), note: "23:59 yesterday" }, // overdue
      { leadId: earlyToday.id, dueAt: at(0.5), note: "00:30 today" }, // due today even though already past
      { leadId: tomorrow.id, dueAt: new Date(today0.getTime() + 24 * 3600_000 + 60_000) }, // not shown
      { leadId: yesterday.id, dueAt: at(-30) },
      { leadId: gone.id, dueAt: at(-30) },
      { leadId: done.id, dueAt: at(-30), doneAt: at(-1) },
    ]);
    await client`update leads set deleted_at = now() where id = ${gone.id}`;
    // a consult today and one tomorrow
    await db.insert(s.consults).values([
      { leadId: earlyToday.id, scheduledAt: at(15) },
      { leadId: tomorrow.id, scheduledAt: at(30) },
    ]);
    // decision due: offer_sent since 4 days ago (yes), 2 days ago (no)
    const o4 = await mk(), o2 = await mk();
    for (const [l, days] of [[o4, 4], [o2, 2]] as const) {
      await client`update leads set stage = 'offer_sent' where id = ${l.id}`;
      await client`insert into stage_events (lead_id, from_stage, to_stage, at) values (${l.id}, 'new', 'offer_sent', ${new Date(now.getTime() - days * 86_400_000).toISOString()})`;
    }
    // contacted lead must not appear as uncontacted
    const contacted = await mk();
    await client`update leads set first_contact_at = now() where id = ${contacted.id}`;

    const t = await getToday(db, { now });
    expect(t.overdue.map((f) => f.leadId).sort()).toEqual([lateNight.id, yesterday.id].sort());
    expect(t.dueToday.map((f) => f.leadName)).toEqual([earlyToday.fullName]);
    expect(t.consultsToday.map((c) => c.leadId)).toEqual([earlyToday.id]);
    expect(t.decisionsDue.map((l) => l.id)).toEqual([o4.id]);
    // no agreed decision date: due once the offer is older than the threshold (3 days by default)
    expect(t.decisionsDue[0].since?.getTime()).toBe(now.getTime() - 4 * 86_400_000);
    const unc = t.queue.filter((q) => q.reason === "new").map((q) => q.leadId);
    expect(unc).not.toContain(contacted.id);
    expect(unc).toContain(tomorrow.id);
    expect(unc).not.toContain(gone.id); // deleted
    expect(unc).toEqual([...unc].sort((x, y) => x - y)); // created in id order == longest waiting first

    const mine = await getToday(db, { now, ownerId: 999999 });
    expect(mine.overdue).toHaveLength(0);
    expect(mine.queue).toHaveLength(0);
  });

  it("bulk: stage moves report per-lead outcomes; assign; cadence skips those already running", async () => {
    const a = await mk(), b = await mk(), c = await mk();
    const r1 = await bulkChangeStage(db, [a.id, b.id, 99999], "contacted", userId);
    expect(r1).toMatchObject({ done: 2, skipped: 1 });
    expect(await bulkChangeStage(db, [a.id], "lost", userId)).toMatchObject({ done: 0, skipped: 1, reasons: ["A lost reason is required"] });
    expect(await bulkChangeStage(db, [a.id], "enrolled", userId)).toMatchObject({ done: 0, skipped: 1 });

    expect(await bulkAssign(db, [a.id, b.id, c.id], null, userId)).toMatchObject({ done: 3, skipped: 0 });
    expect((await db.select().from(s.leads).where(eq(s.leads.id, a.id)))[0].ownerId).toBeNull();
    expect(await bulkAssign(db, [a.id], 424242, userId)).toMatchObject({ done: 0, skipped: 1 });

    await applyCadence(db, { leadId: a.id, templateId: outreach }, userId);
    const r3 = await bulkCadence(db, [a.id, b.id, c.id], outreach, userId);
    expect(r3).toMatchObject({ done: 2, skipped: 1, reasons: ["Cadence already running"] });
  });
});
