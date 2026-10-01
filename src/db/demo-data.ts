import { eq, inArray } from "drizzle-orm";
import type { Db } from "./index";
import * as s from "./schema";

/**
 * Deterministic demo dataset: 20 leads with known funnel, speed, consult, revenue and source numbers.
 * The dashboard tests assert against answers worked out by hand from THIS table (see
 * tests/metrics.integration.test.ts), so change a row here and those numbers change.
 *
 * Every lead is created at 12:00 UTC on `start + createdDay`. `contactMin` is minutes from creation to first
 * outbound message (null = never contacted). `events` are stage moves after creation as [stage, days after
 * creation]; "contacted" is placed at the first-contact time instead of a day offset.
 */
type Seg = "fresh_graduate" | "technician" | "dentist" | "other";
type Tier = "foundation" | "freelance_ready" | "production_partner";
type Ev = [string, number];
export type DemoLead = {
  n: number;
  source: string;
  segment: Seg;
  owner: "Retro" | "Badr";
  campaign?: boolean;
  createdDay: number;
  contactMin: number | null;
  events: Ev[];
  lostReason?: string;
  consult?: { day: number; result: "held" | "no_show" | "pending"; outcome?: "enrolled" | "thinking" | "not_fit"; tags?: string[] };
  enrol?: { tier: Tier; amount: number; cohort: "A" | "B"; paid: boolean };
};

export const DEMO_LEADS: DemoLead[] = [
  { n: 1, source: "Instagram", segment: "dentist", owner: "Retro", createdDay: 0, contactMin: 3, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 5], ["offer_sent", 6], ["enrolled", 10]], consult: { day: 5, result: "held", outcome: "enrolled", tags: ["Price"] }, enrol: { tier: "foundation", amount: 7500, cohort: "A", paid: true } },
  { n: 2, source: "Instagram", segment: "dentist", owner: "Retro", createdDay: 1, contactMin: 4, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 6], ["offer_sent", 7], ["enrolled", 14]], consult: { day: 6, result: "held", outcome: "enrolled", tags: ["Time"] }, enrol: { tier: "freelance_ready", amount: 15000, cohort: "A", paid: true } },
  { n: 3, source: "Masterclass", segment: "dentist", owner: "Retro", campaign: true, createdDay: 2, contactMin: 5, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 3], ["offer_sent", 4], ["enrolled", 7]], consult: { day: 3, result: "held", outcome: "enrolled", tags: ["Price", "Trust"] }, enrol: { tier: "freelance_ready", amount: 15000, cohort: "A", paid: true } },
  { n: 4, source: "Masterclass", segment: "fresh_graduate", owner: "Retro", campaign: true, createdDay: 7, contactMin: 10, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 10], ["offer_sent", 11], ["enrolled", 21]], consult: { day: 10, result: "held", outcome: "enrolled" }, enrol: { tier: "foundation", amount: 7500, cohort: "B", paid: true } },
  { n: 5, source: "Referral", segment: "fresh_graduate", owner: "Retro", createdDay: 8, contactMin: 2, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 4], ["offer_sent", 5], ["enrolled", 9]], consult: { day: 4, result: "held", outcome: "enrolled" }, enrol: { tier: "freelance_ready", amount: 15000, cohort: "B", paid: false } },
  { n: 6, source: "Instagram", segment: "fresh_graduate", owner: "Retro", createdDay: 3, contactMin: 20, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 8], ["offer_sent", 9], ["lost", 12]], lostReason: "Price", consult: { day: 8, result: "held", outcome: "thinking", tags: ["Price"] } },
  { n: 7, source: "Facebook group", segment: "fresh_graduate", owner: "Retro", createdDay: 9, contactMin: 45, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 7], ["lost", 10]], lostReason: "Timing", consult: { day: 7, result: "held", outcome: "not_fit", tags: ["Trust"] } },
  { n: 8, source: "Facebook group", segment: "technician", owner: "Retro", createdDay: 14, contactMin: 8, events: [["replied", 1], ["consult_booked", 2], ["lost", 9]], lostReason: "No response", consult: { day: 5, result: "no_show" } },
  { n: 9, source: "Instagram", segment: "technician", owner: "Retro", createdDay: 4, contactMin: 120, events: [["replied", 1], ["lost", 6]], lostReason: "Not a fit" },
  { n: 10, source: "Instagram", segment: "technician", owner: "Retro", createdDay: 10, contactMin: 1, events: [["lost", 5]], lostReason: "No response" },
  { n: 11, source: "Facebook group", segment: "technician", owner: "Retro", createdDay: 11, contactMin: 15, events: [["nurture", 4]] },
  { n: 12, source: "Masterclass", segment: "technician", owner: "Retro", campaign: true, createdDay: 15, contactMin: 6, events: [["replied", 1], ["consult_booked", 2]], consult: { day: 25, result: "pending" } },
  { n: 13, source: "Referral", segment: "other", owner: "Badr", createdDay: 16, contactMin: 3, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 6], ["offer_sent", 7]], consult: { day: 6, result: "held", outcome: "thinking" } },
  { n: 14, source: "Instagram", segment: "other", owner: "Badr", createdDay: 17, contactMin: 60, events: [] },
  { n: 15, source: "Facebook group", segment: "other", owner: "Badr", createdDay: 21, contactMin: 4, events: [["replied", 1]] },
  { n: 16, source: "Instagram", segment: "other", owner: "Badr", createdDay: 22, contactMin: null, events: [] },
  { n: 17, source: "Masterclass", segment: "other", owner: "Badr", campaign: true, createdDay: 23, contactMin: null, events: [] },
  { n: 18, source: "Referral", segment: "other", owner: "Badr", createdDay: 18, contactMin: 30, events: [["lost", 3]], lostReason: "Price" },
  { n: 19, source: "Instagram", segment: "other", owner: "Badr", createdDay: 24, contactMin: 5, events: [["replied", 1], ["consult_booked", 2], ["consult_held", 9], ["nurture", 10]], consult: { day: 9, result: "held", outcome: "thinking", tags: ["Time"] } },
  { n: 20, source: "Facebook group", segment: "other", owner: "Badr", createdDay: 25, contactMin: 90, events: [] },
];

export const DEMO_START_ISO = "2026-08-03T12:00:00.000Z"; // a Monday; used by the tests
const DAY = 86_400_000;
const at = (start: Date, day: number, extraMin = 0) => new Date(start.getTime() + day * DAY + extraMin * 60_000);

export async function insertDemo(
  db: Db,
  start: Date,
  opts: { now?: Date; withFollowUps?: boolean } = {},
): Promise<void> {
  const [users, sources, reasons, objs] = await Promise.all([
    db.select().from(s.users),
    db.select().from(s.sources),
    db.select().from(s.lostReasons),
    db.select().from(s.objections),
  ]);
  const owner = (name: string) => users.find((u) => u.name === name)!.id;
  const src = (label: string) => sources.find((x) => x.label === label)!.id;
  const reason = (label: string) => reasons.find((x) => x.label === label)!.id;
  const obj = (label: string) => objs.find((x) => x.label === label)!.id;

  // the placeholder cohort from the base seed is replaced by two demo cohorts (only if nobody is enrolled in it)
  const placeholder = await db.select().from(s.cohorts).where(eq(s.cohorts.name, "Demo cohort"));
  for (const p of placeholder) {
    const used = await db.select({ id: s.enrolments.id }).from(s.enrolments).where(eq(s.enrolments.cohortId, p.id)).limit(1);
    if (!used.length) await db.delete(s.cohorts).where(eq(s.cohorts.id, p.id));
  }
  const [cohortA] = await db.insert(s.cohorts).values({ name: "Demo Cohort A", seatCap: 10, masterclassAt: at(start, 1), enrolmentCloseAt: at(start, 20), startAt: at(start, 30) }).returning();
  const [cohortB] = await db.insert(s.cohorts).values({ name: "Demo Cohort B", seatCap: 10, masterclassAt: at(start, 14), enrolmentCloseAt: at(start, 40), startAt: at(start, 50) }).returning();
  const [campaign] = await db.insert(s.campaigns).values({ label: "Masterclass Sep", kind: "masterclass", eventAt: at(start, 1), sourceId: src("Masterclass"), startedAt: start }).returning();

  const staged = new Map<number, number>();
  for (const l of DEMO_LEADS) {
    const created = at(start, l.createdDay);
    const contactAt = l.contactMin === null ? null : at(start, l.createdDay, l.contactMin);
    const evTime = (stage: string, day: number) => (stage === "contacted" ? contactAt! : at(start, l.createdDay + day));
    const path: { stage: string; at: Date }[] = [];
    if (contactAt) path.push({ stage: "contacted", at: contactAt });
    for (const [stage, day] of l.events) path.push({ stage, at: evTime(stage, day) });
    const last = path.length ? path[path.length - 1] : null;
    const final = last?.stage ?? "new";
    const replied = path.find((p) => p.stage === "replied")?.at ?? null;
    const closed = path.find((p) => ["lost", "enrolled"].includes(p.stage))?.at ?? null;

    const [lead] = await db
      .insert(s.leads)
      .values({
        fullName: `Demo Lead ${String(l.n).padStart(2, "0")}`,
        phoneWhatsapp: `+2010800000${String(l.n).padStart(2, "0")}`,
        segment: l.segment,
        sourceId: src(l.source),
        campaignId: l.campaign ? campaign.id : null,
        tierInterest: l.enrol ? l.enrol.tier : "unsure",
        stage: final,
        ownerId: owner(l.owner),
        lostReasonId: l.lostReason ? reason(l.lostReason) : null,
        createdAt: created,
        updatedAt: last?.at ?? created,
        firstContactAt: contactAt,
        firstReplyAt: replied,
        closedAt: closed,
      })
      .returning();
    staged.set(l.n, lead.id);

    // stage history: created as new, then each move (from = the previous stage on the path)
    let prev: string | null = null;
    const events = [{ from: null as string | null, to: "new", at: created }];
    for (const p of path) {
      events.push({ from: prev ?? "new", to: p.stage, at: p.at });
      prev = p.stage;
    }
    await db.insert(s.stageEvents).values(events.map((e) => ({ leadId: lead.id, fromStage: e.from, toStage: e.to, at: e.at, byUserId: owner(l.owner) })));
    if (contactAt) {
      await db.insert(s.activities).values({ leadId: lead.id, type: "whatsapp", direction: "out", body: "First message", at: contactAt, byUserId: owner(l.owner) });
    }

    if (l.consult) {
      const when = at(start, l.createdDay + l.consult.day);
      const [c] = await db
        .insert(s.consults)
        .values({
          leadId: lead.id,
          scheduledAt: when,
          held: l.consult.result === "held",
          outcome: l.consult.result === "held" ? (l.consult.outcome ?? null) : l.consult.result === "no_show" ? "no_show" : null,
        })
        .returning();
      const tagIds = (l.consult.tags ?? []).map(obj);
      if (tagIds.length) await db.insert(s.consultObjections).values(tagIds.map((objectionId) => ({ consultId: c.id, objectionId })));
    }

    if (l.enrol) {
      const enrolledAt = path.find((p) => p.stage === "enrolled")!.at;
      const cohortId = l.enrol.cohort === "A" ? cohortA.id : cohortB.id;
      const [en] = await db
        .insert(s.enrolments)
        .values({ leadId: lead.id, cohortId, tier: l.enrol.tier, amountEgp: l.enrol.amount, createdAt: enrolledAt, updatedAt: enrolledAt })
        .returning();
      // payments live in the ledger: paid = one Received payment, unpaid = one Expected payment
      await db.insert(s.ledgerEntries).values({
        entry: `${lead.fullName} — ${l.enrol.paid ? "payment" : "payment due"}`,
        amountEgp: l.enrol.amount,
        date: l.enrol.paid ? enrolledAt : null,
        section: "income",
        category: "Candidate payment",
        status: l.enrol.paid ? "received" : "expected",
        reference: l.enrol.paid ? `DEMO-${lead.id}` : null,
        enrolmentId: en.id,
        cohortId,
        createdAt: enrolledAt,
        updatedAt: enrolledAt,
      });
    }
  }

  // a few costs and one withdrawal so the finance board shows the split working (all marked DEMO)
  const cost = (entry: string, amountEgp: number, day: number, section: "fixed_costs" | "variable_costs" | "partner_withdrawals", category: string, extra: Partial<typeof s.ledgerEntries.$inferInsert> = {}) => ({
    entry: `DEMO ${entry}`,
    amountEgp,
    date: at(start, day),
    section,
    category,
    status: "paid" as const,
    createdAt: at(start, day),
    updatedAt: at(start, day),
    ...extra,
  });
  await db.insert(s.ledgerEntries).values([
    cost("Editing software", 1200, 3, "fixed_costs", "Subscriptions"),
    cost("Ad creatives", 3500, 9, "variable_costs", "Content creator"),
    cost("Freelance closer commission", 2000, 24, "variable_costs", "Freelancers & sales"),
    cost("Advance to Badr", 3000, 26, "partner_withdrawals", "Partner withdrawal", { partner: "Badr" }),
    cost("Studio rent", 4000, 35, "fixed_costs", "Salaries", { status: "owed" }),
  ]);

  // programme data for the first two students (as it would come from Notion), all marked DEMO
  const firstTwo = await db.select({ id: s.enrolments.id }).from(s.enrolments).orderBy(s.enrolments.id).limit(2);
  for (const [i, e] of firstTwo.entries()) {
    await db
      .update(s.enrolments)
      .set({ contentConsent: i === 0, contentConsentScope: i === 0 ? ["Name", "Video"] : [], qcScore: i === 0 ? 92 : 78, leaderboardRank: i + 1 })
      .where(eq(s.enrolments.id, e.id));
    await db.insert(s.programmeSessions).values({ name: `DEMO 1:1 week ${i + 1}`, enrolmentId: e.id, type: "Production Partner 1:1", dayOfWeek: "Monday", time: "8:00 pm", recorded: true });
  }
  if (firstTwo[0]) {
    await db.insert(s.proofItems).values([
      { name: "DEMO QC result screenshot", enrolmentId: firstTwo[0].id, type: "QC result", consentStatus: "Granted", usableIn: ["Carousel", "Story"] },
      { name: "DEMO voice note after week 2", enrolmentId: firstTwo[0].id, type: "Voice note", consentStatus: "Asked", quote: "DEMO — a real quote goes here, word for word." },
    ]);
  }

  if (opts.withFollowUps && opts.now) {
    // a few open items relative to "now" so the Today screen has something to show
    const now = opts.now;
    const id = (n: number) => staged.get(n)!;
    const day = (offset: number, h = 9) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, h - 3));
    await db.insert(s.followUps).values([
      { leadId: id(14), dueAt: day(-3), kind: "whatsapp", note: "Value clip" },
      { leadId: id(15), dueAt: day(0), kind: "whatsapp", note: "Ask about the masterclass" },
      { leadId: id(13), dueAt: day(0), kind: "call", note: "Decision call" },
      { leadId: id(12), dueAt: day(2), kind: "whatsapp", note: "Remind about the consult" },
    ]);
    await db.insert(s.consults).values({ leadId: id(15), scheduledAt: day(0, 17) });
  }
}

export async function demoLeadIds(db: Db) {
  const rows = await db.select({ id: s.leads.id, name: s.leads.fullName }).from(s.leads).where(inArray(s.leads.fullName, DEMO_LEADS.map((l) => `Demo Lead ${String(l.n).padStart(2, "0")}`)));
  return new Map(rows.map((r) => [Number(r.name.slice(-2)), r.id]));
}
