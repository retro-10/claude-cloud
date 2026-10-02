import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, campaigns, contentItems, decisions, leads, proofItems, stages } from "@/db/schema";
import type { AiSettings } from "../app-settings";
import { PULSE, weekNumbers } from "../command";
import { registrants } from "../events";
import { can } from "../rbac";
import { templateContext } from "../templates";
import { addDaysYmd, cairoYmd, formatCairo } from "../time";
import type { Viewer } from "./ask";
import { AiError, callClaude, redact, textOf } from "./core";

/**
 * AI drafts. Each one is a starting point a person edits and checks: none is sent, posted or saved by itself.
 * They are written in the owners' brand voice (Settings > AI) from facts the app gives Claude, and are told
 * never to add prices, dates, results or promises the facts do not contain.
 */
const RULES = `You write drafts for OrlaDent Camp, a dental design training camp in Egypt (and its production studio, OrlaDent).
Every draft is read and edited by a person before anyone sees it.

Rules for every draft:
- Use only the facts given. Never invent a price, discount, date, deadline, result, testimonial or promise. If a fact the draft needs is missing, write it as a clear placeholder in square brackets, e.g. [price], and keep going.
- No income claims and no pressure tactics.
- Return only the draft itself: no preamble, no explanation, no quotation marks around it.`;

const system = (ai: AiSettings, task: string) => `${RULES}\n\nBrand voice (from the owners):\n${ai.brandVoice}\n\n${task}`;

export type Lang = "en" | "ar";
const LANG = { en: "English", ar: "Egyptian Arabic (informal, warm, the way people in Egypt write on WhatsApp)" };
const lang = (v: unknown): Lang => (v === "ar" ? "ar" : "en");

async function draft(db: Db, v: Viewer, feature: string, sys: string, facts: string, ask: string, maxTokens = 3000) {
  const res = await callClaude(db, { userId: v.id, feature, system: sys, context: `Facts:\n${facts}`, messages: [{ role: "user", content: ask }], effort: "low", maxTokens });
  const text = textOf(res);
  if (!text) throw new AiError("Claude returned an empty draft. Try again.");
  return res.stop_reason === "max_tokens" ? `${text}\n\n[cut short: ask again for a shorter draft]` : text;
}

const json = (o: unknown) => JSON.stringify(o, null, 1);

/** A WhatsApp message to a lead: a reply to what they last said, or a follow-up when they have gone quiet. */
export async function draftLeadMessage(db: Db, v: Viewer, leadId: number, opts: { lang?: unknown; kind?: unknown }, ai: AiSettings) {
  if (!can(v.role, "lead:write")) throw new AiError("Only people who message leads can draft to them");
  const [row] = await db.select({ l: leads, stage: stages.label }).from(leads).leftJoin(stages, eq(stages.key, leads.stage)).where(eq(leads.id, leadId));
  if (!row || row.l.deletedAt) throw new AiError("Lead not found");
  if (row.l.doNotContact) throw new AiError("This lead is marked do-not-contact");
  const l = lang(opts.lang);
  const kind = opts.kind === "followup" ? "followup" : "reply";
  const [ctx, recent] = await Promise.all([
    templateContext(db, leadId, l),
    db.select().from(activities).where(eq(activities.leadId, leadId)).orderBy(desc(activities.at)).limit(12),
  ]);
  const facts = json({
    lead: { firstName: ctx.first_name, stage: row.stage ?? row.l.stage, segment: row.l.segment, city: row.l.city, interestedIn: ctx.tier ?? "not sure yet", notes: row.l.notes ? redact(row.l.notes).slice(0, 1000) : null },
    offer: row.l.offerSentAt ? { tier: ctx.tier, amountEgp: row.l.offerAmountEgp, paymentLinkSent: !!row.l.offerPaymentLink, decisionDate: ctx.decision_date ?? null } : null,
    nextConsult: ctx.consult_time ?? null,
    nextBatch: ctx.cohort_name ? { name: ctx.cohort_name, enrolmentCloses: ctx.cohort_close_date ?? null, masterclass: ctx.masterclass_date ?? null } : null,
    conversation: recent.reverse().map((a) => ({ at: formatCairo(a.at), from: a.direction === "in" ? "lead" : a.direction === "out" ? "us" : "internal note", type: a.type, text: a.body ? redact(a.body).slice(0, 500) : null })),
  });
  const task =
    kind === "reply"
      ? "Write a WhatsApp reply to the lead's latest message. Answer what they asked if the facts allow; if not, say we will check and come back. End with one easy next step."
      : "Write a short WhatsApp follow-up to a lead who has not replied. Pick up from where the conversation stopped, add one useful reason to reply, and make the next step easy. Do not guilt them.";
  return draft(db, v, kind, system(ai, `${task}\nWrite in ${LANG[l]}. WhatsApp style: short lines, at most one emoji, under 90 words. Greet them by first name.`), facts, kind === "reply" ? "Draft the reply." : "Draft the follow-up.", 1500);
}

/** Caption and three hook options for a piece on the content calendar. */
export async function draftCaption(db: Db, v: Viewer, contentId: number, opts: { lang?: unknown }, ai: AiSettings) {
  if (!can(v.role, "growth:write")) throw new AiError("Only people who plan content can draft captions");
  const [c] = await db.select().from(contentItems).where(and(eq(contentItems.id, contentId), isNull(contentItems.deletedAt)));
  if (!c) throw new AiError("Content piece not found");
  const [camp] = c.campaignId ? await db.select().from(campaigns).where(eq(campaigns.id, c.campaignId)) : [];
  const [proof] = c.proofItemId ? await db.select().from(proofItems).where(eq(proofItems.id, c.proofItemId)) : [];
  const l = lang(opts.lang);
  const facts = json({
    title: c.title,
    platform: c.platform,
    format: c.format,
    brief: c.brief ? redact(c.brief).slice(0, 2000) : null,
    campaign: camp ? { name: camp.label, kind: camp.kind, eventAt: camp.eventAt ? formatCairo(camp.eventAt) : null } : null,
    // a student's words only with their consent, and word for word
    proof: proof && proof.consentStatus === "Granted" && proof.quote ? { type: proof.type, quoteWordForWord: redact(proof.quote).slice(0, 800) } : null,
    linkGoesIn: c.platform === "instagram" || c.platform === "tiktok" ? "bio or story (say 'link in bio')" : "the caption",
  });
  return draft(
    db,
    v,
    "caption",
    system(
      ai,
      `Write social media copy in ${LANG[l]}. Output exactly:\nHOOKS\n1. …\n2. …\n3. …\n\nCAPTION\n…\n\nThe hooks are three different opening lines (on-screen text or first line), under 12 words each. The caption fits the platform and format, ends with one call to action, and has at most 5 relevant hashtags. If there is a proof quote, use it word for word in quotation marks and change nothing in it.`,
    ),
    facts,
    "Draft the hooks and the caption.",
  );
}

/** A run-of-show script for a masterclass, from what the app knows about it and who registered. */
export async function draftScript(db: Db, v: Viewer, campaignId: number, opts: { minutes?: unknown; lang?: unknown }, ai: AiSettings) {
  if (!can(v.role, "growth:write")) throw new AiError("Only people who run masterclasses can draft scripts");
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) throw new AiError("Masterclass not found");
  const people = await registrants(db, campaignId);
  const minutes = [45, 60, 90].includes(Number(opts.minutes)) ? Number(opts.minutes) : 60;
  const l = lang(opts.lang);
  const ids = people.map((p) => p.id);
  const segs = ids.length ? await db.select({ segment: leads.segment }).from(leads).where(inArray(leads.id, ids)) : [];
  const segments: Record<string, number> = {};
  for (const p of segs) segments[p.segment ?? "unknown"] = (segments[p.segment ?? "unknown"] ?? 0) + 1;
  const ctx = await templateContext(db, ids[0] ?? 0, l);
  const facts = json({
    title: c.label,
    when: c.eventAt ? formatCairo(c.eventAt) : null,
    notes: c.notes ? redact(c.notes).slice(0, 2000) : null,
    registered: people.length,
    whoRegistered: segments,
    nextBatch: ctx.cohort_name ? { name: ctx.cohort_name, enrolmentCloses: ctx.cohort_close_date ?? null } : null,
    lengthMinutes: minutes,
  });
  return draft(
    db,
    v,
    "script",
    system(
      ai,
      `Write a masterclass run-of-show in ${LANG[l]} for a ${minutes}-minute live session. Use timed sections (e.g. "0:00–5:00 Welcome"), and for each: what to say (talking points, not a word-for-word speech), what to show, and one interaction (a poll or question). Teach something genuinely useful first; the invitation to the camp comes only in the last tenth, once, plainly, with the next step. Pitch to who registered.`,
    ),
    facts,
    "Draft the run-of-show.",
    6000,
  );
}

/** Wins, misses and decisions for a week's review, from the week's numbers against the week before. */
export async function draftWeekly(db: Db, v: Viewer, weekStart: string, ai: AiSettings) {
  if (!can(v.role, "ops:manage")) throw new AiError("Only owners write the weekly review");
  const money = can(v.role, "finance:read");
  const [now, before, open] = await Promise.all([
    weekNumbers(db, weekStart),
    weekNumbers(db, addDaysYmd(weekStart, -7)),
    db.select({ title: decisions.title, dueAt: decisions.dueAt }).from(decisions).where(eq(decisions.status, "open")).limit(15),
  ]);
  const facts = json({
    week: `${weekStart} to ${addDaysYmd(weekStart, 6)}`,
    numbers: PULSE.filter((p) => money || !p.money).map((p) => ({ measure: p.label, thisWeek: now[p.key], weekBefore: before[p.key] })),
    openDecisions: open.map((d) => ({ title: d.title, due: d.dueAt ? cairoYmd(d.dueAt) : null })),
  });
  return draft(
    db,
    v,
    "weekly",
    system(
      ai,
      "Draft the owners' weekly review in English. Output exactly three sections headed WINS, MISSES and DECISIONS, each a short bullet list. Base wins and misses on the numbers (say the figures and the change); for decisions, suggest at most three concrete things to decide this week, and list open decisions that are due. If a number is 0 in both weeks, leave it out.",
    ),
    facts,
    "Draft this week's review.",
  );
}
