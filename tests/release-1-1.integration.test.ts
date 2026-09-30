import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { bookConsult, confirmConsult, markConsult } from "@/lib/consults";
import { recordConsent } from "@/lib/consent";
import { enrolLead } from "@/lib/enrol";
import { changeStage, createLead, logActivity, reactivateLead, updateOffer } from "@/lib/leads";
import { listLeads } from "@/lib/lead-list";
import { mergeLeads, undoMerge } from "@/lib/merge";
import { getMetrics } from "@/lib/metrics";
import { getBoard } from "@/lib/pipeline";
import { searchLeads } from "@/lib/search";
import { templateContext } from "@/lib/templates";
import { getToday } from "@/lib/today";
import { viewCounts } from "@/lib/views";
import { runScheduledRules, setRuleEnabled } from "@/lib/workflows";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Release 1.1 acceptance criteria, with the shipped defaults switched ON (exit criteria + built-in rules).
d("release 1.1", () => {
  const client = postgres(url ?? "postgres://x", { max: 6, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number;
  let seq = 0;
  const DAY = 86_400_000;
  const phone = () => `0101${String(++seq).padStart(7, "0")}`;
  const mk = async (fullName = `Lead ${seq + 1}`, extra: Partial<Parameters<typeof createLead>[1]> = {}) => {
    const r = await createLead(db, { fullName, phone: phone(), ...extra }, userId, { allowNameMatch: true });
    if (!r.ok) throw new Error(`setup: ${r.error}`);
    return r.lead;
  };
  const fus = (leadId: number) => db.select().from(s.followUps).where(eq(s.followUps.leadId, leadId));
  const openFus = (leadId: number) =>
    db.select().from(s.followUps).where(and(eq(s.followUps.leadId, leadId), isNull(s.followUps.doneAt), isNull(s.followUps.cancelledAt)));
  const rule = async (key: string) => (await db.select().from(s.workflowRules).where(eq(s.workflowRules.key, key)))[0];
  const runsOf = async (key: string, leadId: number) =>
    (await db.select().from(s.workflowRuns).where(and(eq(s.workflowRuns.ruleId, (await rule(key)).id), eq(s.workflowRuns.leadId, leadId))));
  const reason = async (label: string) => (await db.select().from(s.lostReasons).where(eq(s.lostReasons.label, label)))[0];

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await seedReference(url, "pw"); // idempotent: nothing duplicated
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  beforeEach(async () => {
    await client`update workflow_rules set enabled = true`;
  });
  afterAll(() => client.end());

  it("seeds the defaults once: criteria, 8 built-in rules, templates, no-decision reason", async () => {
    expect(await db.select().from(s.workflowRules)).toHaveLength(8);
    expect((await db.select().from(s.stageExitCriteria)).length).toBeGreaterThanOrEqual(13);
    expect((await db.select().from(s.messageTemplates)).length).toBeGreaterThan(5);
    expect((await reason("No decision")).kind).toBe("no_decision");
  });

  // ---------------- P1 exit criteria ----------------

  it("P1: Consult held -> Offer sent without a decision date is blocked with a clear message; an override is audit-logged", async () => {
    const l = await mk();
    await client`update leads set stage = 'consult_held' where id = ${l.id}`;
    await updateOffer(db, l.id, { offerTier: "freelance_ready", offerAmountEgp: 15000, offerPaymentLink: "https://pay.example/x", linkSent: true }, userId);

    const blocked = await changeStage(db, l.id, "offer_sent", userId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.missing?.map((m) => m.key)).toEqual(["decision_date"]);
      expect(blocked.error).toMatch(/decision date agreed/);
    }

    expect(await changeStage(db, l.id, "offer_sent", userId, { override: "Agreed by phone, date to follow" })).toEqual({ ok: true });
    const [a] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, "stage_override"), eq(s.auditLog.entityId, String(l.id))));
    expect(a.diff).toMatchObject({ to: "offer_sent", missing: ["decision_date"], reason: "Agreed by phone, date to follow" });
  });

  it("P1: buyer actions gate the early stages; automatic moves wait for them", async () => {
    const l = await mk();
    expect((await changeStage(db, l.id, "contacted", userId)).ok).toBe(false); // nothing sent yet
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "out" }, userId);
    expect(await changeStage(db, l.id, "contacted", userId)).toEqual({ ok: true });
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "in" }, userId);
    expect(await changeStage(db, l.id, "replied", userId)).toEqual({ ok: true });

    // booking alone does not move the lead: the lead must confirm the time
    const c = await bookConsult(db, { leadId: l.id, scheduledAt: new Date(Date.now() + DAY) }, userId);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, l.id)))[0].stage).toBe("replied");
    await confirmConsult(db, c!.id, true, userId);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, l.id)))[0].stage).toBe("consult_booked");
  });

  it("P1: enrolment needs a payment reference", async () => {
    const l = await mk();
    const [c] = await db.insert(s.cohorts).values({ name: "P1 cohort", seatCap: 5 }).returning();
    const no = await enrolLead(db, { leadId: l.id, cohortId: c.id, tier: "foundation", amountEgp: 7500 }, userId);
    expect(no).toMatchObject({ ok: false, error: "criteria" });
    const yes = await enrolLead(db, { leadId: l.id, cohortId: c.id, tier: "foundation", amountEgp: 7500, paymentRef: "PMB-123" }, userId);
    expect(yes.ok).toBe(true);
  });

  // ---------------- W1 built-in rules ----------------

  it("W1 rule 1: a new lead gets a 5-minute reply task and a notification", async () => {
    const before = Date.now();
    const l = await mk();
    const [f] = await fus(l.id);
    expect(f).toMatchObject({ kind: "reply", note: "Reply within 5 minutes" });
    expect(Math.round((f.dueAt.getTime() - before) / 60_000)).toBe(5);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.leadId, l.id)))[0].title).toContain(l.fullName);
    expect(await runsOf("new_lead_reply", l.id)).toHaveLength(1);
    // answering completes the reply task
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "out" }, userId);
    expect(await openFus(l.id)).toHaveLength(0);
  });

  it("W1 rule 2: an inbound reply stops the cadence (manual tasks stay) and creates a reply-now task", async () => {
    const l = await mk();
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "out" }, userId);
    const [tpl] = await db.select().from(s.cadenceTemplates).where(eq(s.cadenceTemplates.name, "Outreach, 14 days"));
    const { applyCadence, createFollowUp } = await import("@/lib/followups");
    await applyCadence(db, { leadId: l.id, templateId: tpl.id }, userId);
    await createFollowUp(db, { leadId: l.id, dueAt: new Date(Date.now() + 5 * DAY), note: "manual" }, userId);
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "in" }, userId);
    const open = await openFus(l.id);
    expect(open.map((f) => f.note).sort()).toEqual(["They replied: answer them", "manual"]);
  });

  it("W1 rules 3 and 4: consult outcome thinking -> post-consult cadence; no-show -> recovery in 2 hours", async () => {
    const a = await mk();
    const c1 = await bookConsult(db, { leadId: a.id, scheduledAt: new Date() }, userId);
    await markConsult(db, { consultId: c1!.id, result: "held", outcome: "thinking" }, userId);
    const [post] = await db.select().from(s.cadenceTemplates).where(eq(s.cadenceTemplates.name, "Post-consult"));
    expect((await openFus(a.id)).filter((f) => f.templateId === post.id)).toHaveLength(post.steps.length);

    const b = await mk();
    const c2 = await bookConsult(db, { leadId: b.id, scheduledAt: new Date() }, userId);
    const t0 = Date.now();
    await markConsult(db, { consultId: c2!.id, result: "no_show" }, userId);
    const rec = (await openFus(b.id)).find((f) => f.note === "No-show: offer a new time")!;
    expect(Math.round((rec.dueAt.getTime() - t0) / 60_000)).toBe(120);
  });

  it("W1 rule 5: moving to Offer sent creates the follow-up on the agreed decision date", async () => {
    const l = await mk();
    await client`update leads set stage = 'consult_held' where id = ${l.id}`;
    const decision = new Date(Date.now() + 4 * DAY);
    await updateOffer(db, l.id, { offerTier: "foundation", offerAmountEgp: 7500, offerPaymentLink: "https://pay.example/y", linkSent: true, decisionDueAt: decision }, userId);
    expect(await changeStage(db, l.id, "offer_sent", userId)).toEqual({ ok: true });
    expect((await openFus(l.id)).find((f) => f.note === "Decision day: ask for their answer")?.dueAt.getTime()).toBe(decision.getTime());
  });

  it("W1 rule 6: a follow-up overdue by 24h notifies once, however often the sweep runs", async () => {
    const l = await mk();
    await client`update follow_ups set due_at = now() - interval '25 hours' where lead_id = ${l.id}`;
    await runScheduledRules(db);
    await runScheduledRules(db);
    expect(await runsOf("overdue_24h", l.id)).toHaveLength(1);
    expect((await db.select().from(s.notifications).where(eq(s.notifications.leadId, l.id))).some((n) => n.title.startsWith("Overdue 24h"))).toBe(true);
  });

  it("W1 rule 7: Lost cancels open follow-ups and sends price/timing losses to nurture review", async () => {
    const a = await mk(), b = await mk();
    await changeStage(db, a.id, "lost", userId, { lostReasonId: (await reason("Price")).id });
    await changeStage(db, b.id, "lost", userId, { lostReasonId: (await reason("Not a fit")).id });
    expect(await openFus(a.id)).toHaveLength(0);
    const [la] = await db.select().from(s.leads).where(eq(s.leads.id, a.id));
    const [lb] = await db.select().from(s.leads).where(eq(s.leads.id, b.id));
    expect(la.tags).toContain("nurture-review");
    expect(lb.tags).not.toContain("nurture-review");
  });

  it("W1: disabling a rule stops its effect; the run log shows only what fired", async () => {
    await setRuleEnabled(db, (await rule("new_lead_reply")).id, false, userId);
    const l = await mk();
    expect(await fus(l.id)).toHaveLength(0);
    expect(await runsOf("new_lead_reply", l.id)).toHaveLength(0);
  });

  it("A3 + W1 rule 8: routes pick the owner; an unassigned lead past the red time alerts every owner once", async () => {
    const [ig] = await db.select().from(s.sources).where(eq(s.sources.label, "Instagram"));
    const [badr] = await db.select().from(s.users).where(eq(s.users.email, "badr@orladent.local"));
    await saveSettings(db, { routes: [{ field: "source", value: "Instagram", userId: badr.id }] }, userId);
    expect((await mk("Routed", { sourceId: ig.id })).ownerId).toBe(badr.id);
    expect((await mk("Not routed")).ownerId).toBe(userId); // no default owner: whoever adds it
    await saveSettings(db, { routes: [] }, userId);

    const l = await mk("Nobody's", { ownerId: null });
    await client`update leads set created_at = now() - interval '45 minutes' where id = ${l.id}`;
    await runScheduledRules(db);
    await runScheduledRules(db);
    const owners = await db.select().from(s.users).where(and(eq(s.users.role, "owner"), eq(s.users.active, true)));
    const notes = (await db.select().from(s.notifications).where(eq(s.notifications.leadId, l.id))).filter((n) => n.kind === "unassigned_escalation");
    expect(notes).toHaveLength(owners.length);
  });

  // ---------------- P3 / P4 / P6 / V1 ----------------

  it("P3: 15 days of silence is Neglected even with a follow-up booked in the future; P4 days in stage", async () => {
    const l = await mk("Silent Sara");
    await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "out" }, userId);
    await client`update activities set at = now() - interval '15 days' where lead_id = ${l.id}`;
    await client`update leads set created_at = now() - interval '20 days' where id = ${l.id}`;
    await client`update stage_events set at = now() - interval '20 days' where lead_id = ${l.id}`;
    await client`update follow_ups set due_at = now() + interval '30 days', done_at = null where lead_id = ${l.id}`;

    const neglected = await listLeads(db, { view: "neglected" });
    expect(neglected.rows.map((r) => r.id)).toContain(l.id);
    const card = (await getBoard(db)).cards.find((c) => c.id === l.id)!;
    expect(card).toMatchObject({ neglected: true, stale: false, daysInStage: 20 });
    await client`update stage_events set at = now() - interval '31 days' where lead_id = ${l.id}`;
    expect((await listLeads(db, { view: "stale" })).rows.map((r) => r.id)).toContain(l.id);
  });

  it("P6: an open lead with no open follow-up is in No next step, on Today and in the sidebar count", async () => {
    const l = await mk("Stepless Sami");
    await client`update follow_ups set cancelled_at = now() where lead_id = ${l.id}`;
    expect((await listLeads(db, { view: "no_next_step" })).rows.map((r) => r.id)).toContain(l.id);
    expect((await getToday(db)).noNextStep.map((x) => x.id)).toContain(l.id);
    // every sidebar count equals its list's total (the two use separately written SQL)
    const counts = await viewCounts(db);
    for (const [k, n] of Object.entries(counts)) expect(n, k).toBe((await listLeads(db, { view: k })).total);
    // moving to Nurture needs a next contact date, and giving one creates the follow-up
    expect((await changeStage(db, l.id, "nurture", userId)).ok).toBe(false);
    expect(await changeStage(db, l.id, "nurture", userId, { nextStepDate: new Date(Date.now() + 7 * DAY) })).toEqual({ ok: true });
    expect(await openFus(l.id)).toHaveLength(1);
  });

  // ---------------- P5 ----------------

  it("P5: lost without a reason is impossible; the dashboard splits explicit no from no decision; review can reactivate", async () => {
    const a = await mk(), b = await mk();
    expect((await changeStage(db, a.id, "lost", userId)).ok).toBe(false);
    await changeStage(db, a.id, "lost", userId, { lostReasonId: (await reason("No decision")).id });
    await changeStage(db, b.id, "lost", userId, { lostReasonId: (await reason("Trust")).id });
    const m = await getMetrics(db, {});
    expect(m.leaks.lostNoDecision).toBeGreaterThanOrEqual(1);
    expect(m.leaks.lostExplicit).toBeGreaterThanOrEqual(1);
    expect((await listLeads(db, { view: "no_decision_review" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect(await reactivateLead(db, a.id, new Date(Date.now() + 3 * DAY), userId)).toEqual({ ok: true });
    expect((await listLeads(db, { view: "no_decision_review" })).rows).toHaveLength(0);
  });

  // ---------------- D2 / D3 ----------------

  it("D2: same name (spelling variant) and city warns but can be created anyway; a name alone does not warn", async () => {
    await createLead(db, { fullName: "أحمد سمير", phone: phone(), city: "Giza" }, userId, { allowNameMatch: true });
    const warn = await createLead(db, { fullName: "احمد سمير", phone: phone(), city: "giza" }, userId);
    expect(warn).toMatchObject({ ok: false, error: "possible_duplicate" });
    expect((await createLead(db, { fullName: "احمد سمير", phone: phone() }, userId)).ok).toBe(true); // no city: name only
    expect((await createLead(db, { fullName: "احمد سمير", phone: phone(), city: "Giza" }, userId, { allowNameMatch: true })).ok).toBe(true);
  });

  it("D3: merging keeps every activity, follow-up and consult exactly once; undo puts both back", async () => {
    const a = await mk("Mona A"), b = await mk("Mona B", { email: "mona@example.com" });
    for (const [l, n] of [[a, 3], [b, 2]] as const) for (let i = 0; i < n; i++) await logActivity(db, { leadId: l.id, type: "note", direction: "internal", body: `${l.id}-${i}` }, userId);
    await bookConsult(db, { leadId: b.id, scheduledAt: new Date(Date.now() + DAY) }, userId);
    const bPhone = b.phoneWhatsapp;

    const r = await mergeLeads(db, { survivorId: a.id, loserId: b.id, pick: { email: "loser", phoneWhatsapp: "loser" } }, userId);
    expect(r.ok).toBe(true);
    const acts = await db.select().from(s.activities).where(eq(s.activities.leadId, a.id));
    expect(acts.map((x) => x.body).filter((x) => x?.includes("-")).sort()).toEqual([`${a.id}-0`, `${a.id}-1`, `${a.id}-2`, `${b.id}-0`, `${b.id}-1`].sort());
    expect(await db.select().from(s.consults).where(eq(s.consults.leadId, a.id))).toHaveLength(1);
    const [merged] = await db.select().from(s.leads).where(eq(s.leads.id, a.id));
    expect(merged).toMatchObject({ email: "mona@example.com", phoneWhatsapp: bPhone });
    const [gone] = await db.select().from(s.leads).where(eq(s.leads.id, b.id));
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(a.id);
    expect((await db.select().from(s.auditLog).where(eq(s.auditLog.action, "merge"))).length).toBeGreaterThan(0);

    if (r.ok) expect(await undoMerge(db, r.mergeId, userId)).toMatchObject({ ok: true });
    expect(await db.select().from(s.activities).where(eq(s.activities.leadId, b.id))).toHaveLength(acts.filter((x) => x.leadId === a.id).length - 3);
    const [back] = await db.select().from(s.leads).where(eq(s.leads.id, b.id));
    expect(back).toMatchObject({ deletedAt: null, phoneWhatsapp: bPhone, email: "mona@example.com" });
    const [aBack] = await db.select().from(s.leads).where(eq(s.leads.id, a.id));
    expect(aBack.phoneWhatsapp).toBe(a.phoneWhatsapp);
    if (r.ok) expect(await undoMerge(db, r.mergeId, userId)).toMatchObject({ ok: false }); // only once
  });

  it("D3: undo expires after 7 days", async () => {
    const a = await mk(), b = await mk();
    const r = await mergeLeads(db, { survivorId: a.id, loserId: b.id, pick: {} }, userId);
    if (!r.ok) throw new Error("merge");
    expect(await undoMerge(db, r.mergeId, userId, new Date(Date.now() + 8 * DAY))).toMatchObject({ ok: false });
  });

  // ---------------- V2 / M1 / G1 ----------------

  it("V2: search finds Arabic variants and local-format phone numbers", async () => {
    const l = await mk("فاطمة الزهراء");
    const local = "0" + l.phoneWhatsapp!.slice(3); // +20 1xx… -> 01xx…
    expect((await searchLeads(db, "فاطمه")).map((h) => h.id)).toContain(l.id);
    expect((await searchLeads(db, `${local.slice(0, 4)} ${local.slice(4, 7)}-${local.slice(7)}`)).map((h) => h.id)).toContain(l.id);
    expect((await listLeads(db, { q: local })).rows.map((r) => r.id)).toContain(l.id);
  });

  it("M1: placeholders come from the lead and the next open cohort; missing ones are reported", async () => {
    const close = new Date(Date.now() + 10 * DAY);
    await db.insert(s.cohorts).values({ name: "October cohort", seatCap: 10, enrolmentCloseAt: close });
    const l = await mk("Nour Hassan", { tierInterest: "freelance_ready" });
    const ctx = await templateContext(db, l.id, "en");
    expect(ctx).toMatchObject({ first_name: "Nour", tier: "Freelance Ready", cohort_name: "October cohort" });
    expect(ctx.cohort_close_date).toBeTruthy();
    expect(ctx.payment_link).toBeUndefined();
  });

  it("G1: a refusal marks the lead do-not-contact", async () => {
    const l = await mk();
    await recordConsent(db, { leadId: l.id, granted: false, method: "refused" }, userId);
    expect((await db.select().from(s.leads).where(eq(s.leads.id, l.id)))[0].doNotContact).toBe(true);
  });
});
