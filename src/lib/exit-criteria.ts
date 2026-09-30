import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, consultObjections, consults, followUps, leads, stageExitCriteria } from "@/db/schema";

/**
 * P1: stage moves are earned. Each check describes something the BUYER did (or a fact recorded about
 * the deal) that must be true before a lead may ENTER a stage. Which checks apply to which stage lives
 * in stage_exit_criteria and is edited in Settings; the checks themselves are code.
 */
export type CheckKey =
  | "outbound_logged"
  | "inbound_logged"
  | "consult_confirmed"
  | "consult_held"
  | "consult_objections"
  | "consult_tier"
  | "offer_tier"
  | "offer_price"
  | "offer_link_sent"
  | "decision_date"
  | "payment_reference"
  | "lost_reason"
  | "next_step";

export const CHECKS: Record<CheckKey, { label: string; fix: string }> = {
  outbound_logged: { label: "First outbound message logged", fix: "Log the message you sent (WhatsApp, call, DM)." },
  inbound_logged: { label: "Reply from the lead logged", fix: "Log their reply as an incoming message." },
  consult_confirmed: { label: "Consult booked and confirmed by the lead", fix: "Book the consult and tick “Lead confirmed”." },
  consult_held: { label: "Consult marked as held", fix: "Record the consult result as held." },
  consult_objections: { label: "Objections recorded", fix: "Tick the objections raised in the consult." },
  consult_tier: { label: "Tier recommendation recorded", fix: "Choose the tier you recommended in the consult." },
  offer_tier: { label: "Tier chosen", fix: "Set the offer tier." },
  offer_price: { label: "Price stated", fix: "Enter the price you quoted." },
  offer_link_sent: { label: "Payment link sent", fix: "Add the payment link and mark it sent." },
  decision_date: { label: "Decision date agreed", fix: "Enter the date they said they will decide by." },
  payment_reference: { label: "Payment confirmed with a reference", fix: "Enter the payment reference." },
  lost_reason: { label: "Lost reason selected", fix: "Pick a lost reason." },
  next_step: { label: "Next contact date set", fix: "Choose when to contact them next." },
};

export const CHECK_KEYS = Object.keys(CHECKS) as CheckKey[];

export { DEFAULT_CRITERIA } from "@/db/seed-data";

/** Facts supplied with the move itself (e.g. the lost reason picked in the dialog). */
export type MoveContext = { lostReasonId?: number | null; paymentRef?: string | null; nextStepDate?: Date | null };
export type Missing = { key: CheckKey; label: string; fix: string };

type Exec = Pick<Db, "select">;

export async function requiredChecks(db: Exec, stageKey: string): Promise<CheckKey[]> {
  const rows = await db
    .select({ k: stageExitCriteria.checkKey })
    .from(stageExitCriteria)
    .where(and(eq(stageExitCriteria.stageKey, stageKey), eq(stageExitCriteria.required, true)))
    .orderBy(asc(stageExitCriteria.id));
  return rows.map((r) => r.k as CheckKey).filter((k) => k in CHECKS);
}

const CONTACT = sql`('whatsapp','call','instagram','linkedin','email')`;

/** Evaluates only the checks asked for, with one query per kind of fact. */
export async function evaluate(db: Exec, leadId: number, checks: CheckKey[], ctx: MoveContext = {}): Promise<Missing[]> {
  if (!checks.length) return [];
  const want = new Set(checks);
  const ok = new Set<CheckKey>();

  if (want.has("outbound_logged") || want.has("inbound_logged")) {
    const rows = await db
      .select({ direction: activities.direction })
      .from(activities)
      .where(and(eq(activities.leadId, leadId), sql`${activities.type} in ${CONTACT}`, inArray(activities.direction, ["in", "out"])));
    if (rows.some((r) => r.direction === "out")) ok.add("outbound_logged");
    if (rows.some((r) => r.direction === "in")) ok.add("inbound_logged");
  }

  if (want.has("consult_confirmed") || want.has("consult_held") || want.has("consult_objections") || want.has("consult_tier")) {
    const cs = await db.select().from(consults).where(eq(consults.leadId, leadId));
    if (cs.some((c) => c.confirmedAt && !c.held && c.outcome !== "no_show")) ok.add("consult_confirmed");
    const held = cs.filter((c) => c.held);
    if (held.length) ok.add("consult_held");
    if (held.some((c) => c.recommendedTier)) ok.add("consult_tier");
    if (held.length) {
      const [o] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(consultObjections)
        .where(inArray(consultObjections.consultId, held.map((c) => c.id)));
      if (o.n > 0) ok.add("consult_objections");
    }
  }

  if (["offer_tier", "offer_price", "offer_link_sent", "decision_date"].some((k) => want.has(k as CheckKey))) {
    const [l] = await db.select().from(leads).where(eq(leads.id, leadId));
    if (l?.offerTier) ok.add("offer_tier");
    if (l?.offerAmountEgp && l.offerAmountEgp > 0) ok.add("offer_price");
    if (l?.offerSentAt && l.offerPaymentLink) ok.add("offer_link_sent");
    if (l?.decisionDueAt) ok.add("decision_date");
  }

  if (ctx.paymentRef?.trim()) ok.add("payment_reference");
  if (ctx.lostReasonId) ok.add("lost_reason");

  if (want.has("next_step")) {
    if (ctx.nextStepDate) ok.add("next_step");
    else {
      const [f] = await db
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(eq(followUps.leadId, leadId), isNull(followUps.doneAt), isNull(followUps.cancelledAt)))
        .limit(1);
      if (f) ok.add("next_step");
    }
  }

  return checks.filter((k) => !ok.has(k)).map((k) => ({ key: k, ...CHECKS[k] }));
}

/** Everything still missing for `leadId` to enter `stageKey` (empty = the move is allowed). */
export async function missingFor(db: Exec, leadId: number, stageKey: string, ctx: MoveContext = {}): Promise<Missing[]> {
  return evaluate(db, leadId, await requiredChecks(db, stageKey), ctx);
}

export function describeMissing(m: Missing[]): string {
  return `Not ready yet: ${m.map((x) => x.label.toLowerCase()).join(", ")}.`;
}
