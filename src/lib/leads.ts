import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, followUps, leads, lostReasons, sources, stageEvents, stages } from "@/db/schema";
import { getSettings } from "./app-settings";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { describeMissing, missingFor, type Missing } from "./exit-criteria";
import { cancelCadenceFollowUps } from "./followups";
import { normalizePhone } from "./phone";
import { foldedSql, foldArabic } from "./search";
import { fireRules } from "./workflows";

type Lead = typeof leads.$inferSelect;

export type NewLeadInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  segment?: Lead["segment"];
  sourceId?: number | null;
  campaignId?: number | null;
  tierInterest?: Lead["tierInterest"];
  notes?: string | null;
  ownerId?: number | null;
  attribution?: Record<string, string> | null; // utm_* and the form, from a public form or the inbound webhook
};

export type Duplicate = { id: number; fullName: string; deleted: boolean; matchedOn: "phone" | "email" | "name and city" };

const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

// Includes soft-deleted leads: phone is unique across all rows, so a deleted match must be
// surfaced (and offered for restore) instead of failing on the constraint.
export async function findDuplicates(
  db: Pick<Db, "select">,
  { phone, email }: { phone?: string | null; email?: string | null },
  excludeId?: number,
): Promise<Duplicate[]> {
  const e164 = normalizePhone(phone);
  const mail = blank(email)?.toLowerCase();
  const conds = [];
  if (e164) conds.push(eq(leads.phoneWhatsapp, e164));
  if (mail) conds.push(sql`lower(${leads.email}) = ${mail}`);
  if (!conds.length) return [];
  const rows = await db
    .select({ id: leads.id, fullName: leads.fullName, phone: leads.phoneWhatsapp, email: leads.email, deletedAt: leads.deletedAt })
    .from(leads)
    .where(and(or(...conds), excludeId ? sql`${leads.id} <> ${excludeId}` : undefined));
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    deleted: r.deletedAt !== null,
    matchedOn: e164 && r.phone === e164 ? "phone" : "email",
  }));
}

/**
 * D2, medium confidence: same name (Arabic spelling variants folded) and same city, different contact
 * details. Only a warning: the person adding the lead decides. A name alone never matches.
 */
export async function findNameCityMatches(db: Pick<Db, "select">, fullName: string, city: string | null | undefined, excludeId?: number): Promise<Duplicate[]> {
  const c = blank(city);
  if (!c || !fullName.trim()) return [];
  const rows = await db
    .select({ id: leads.id, fullName: leads.fullName })
    .from(leads)
    .where(
      and(
        isNull(leads.deletedAt),
        sql`${foldedSql(leads.fullName)} = ${foldArabic(fullName.trim())}`,
        sql`${foldedSql(sql`coalesce(${leads.city}, '')`)} = ${foldArabic(c)}`,
        excludeId ? sql`${leads.id} <> ${excludeId}` : undefined,
      ),
    )
    .limit(5);
  return rows.map((r) => ({ id: r.id, fullName: r.fullName, deleted: false, matchedOn: "name and city" as const }));
}

/** A3: first matching route (source or segment) decides the owner, then the default owner, then the creator. */
export async function assignOwner(db: Pick<Db, "select">, input: Pick<NewLeadInput, "sourceId" | "segment">, creatorId: number | null): Promise<number | null> {
  const s = await getSettings(db);
  for (const r of s.routes) {
    if (r.field === "segment" && input.segment && r.value === input.segment) return r.userId;
    if (r.field === "source" && input.sourceId) {
      const [src] = await db.select({ label: sources.label }).from(sources).where(eq(sources.id, input.sourceId));
      if (src && (src.label === r.value || String(input.sourceId) === r.value)) return r.userId;
    }
  }
  return s.defaultOwnerId ?? creatorId;
}

export type CreateResult =
  | { ok: true; lead: Lead }
  | { ok: false; error: "duplicate"; duplicates: Duplicate[] }
  | { ok: false; error: "possible_duplicate"; duplicates: Duplicate[] }
  | { ok: false; error: "invalid_phone" };

export async function createLead(
  db: Db,
  input: NewLeadInput,
  userId: number | null,
  opts: { allowNameMatch?: boolean; runRules?: boolean } = {},
): Promise<CreateResult> {
  const phone = blank(input.phone) ? normalizePhone(input.phone) : null;
  if (blank(input.phone) && !phone) return { ok: false, error: "invalid_phone" };

  const duplicates = await findDuplicates(db, { phone, email: input.email });
  if (duplicates.length) return { ok: false, error: "duplicate", duplicates };
  if (!opts.allowNameMatch) {
    const similar = await findNameCityMatches(db, input.fullName, input.city);
    if (similar.length) return { ok: false, error: "possible_duplicate", duplicates: similar };
  }
  const ownerId = input.ownerId !== undefined ? input.ownerId : await assignOwner(db, input, userId);

  try {
    const lead = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(leads)
        .values({
          fullName: input.fullName.trim(),
          phoneWhatsapp: phone,
          phoneRaw: blank(input.phone),
          email: blank(input.email)?.toLowerCase() ?? null,
          city: blank(input.city),
          segment: input.segment ?? null,
          sourceId: input.sourceId ?? null,
          campaignId: input.campaignId ?? null,
          tierInterest: input.tierInterest ?? "unsure",
          notes: blank(input.notes),
          ownerId,
          attribution: input.attribution && Object.keys(input.attribution).length ? input.attribution : null,
        })
        .returning();
      // creation is the funnel's first event (from_stage NULL -> new)
      await tx.insert(stageEvents).values({ leadId: row.id, fromStage: null, toStage: "new", byUserId: userId });
      await audit(tx, { userId, entity: "lead", entityId: row.id, action: "create" });
      if (opts.runRules !== false) await fireRules(tx as unknown as Db, { trigger: "lead_created", leadId: row.id }, userId);
      return row;
    });
    return { ok: true, lead };
  } catch (e) {
    // Two people adding the same person at the same moment both pass the check above; the unique
    // index stops the second. Report it as the duplicate it is instead of leaking the driver's
    // message, which contains the phone number.
    if (isUniqueViolation(e)) {
      const again = await findDuplicates(db, { phone, email: input.email });
      if (again.length) return { ok: false, error: "duplicate", duplicates: again };
    }
    throw e;
  }
}

export type ActivityInput = {
  leadId: number;
  type: (typeof activities.$inferInsert)["type"];
  direction: (typeof activities.$inferInsert)["direction"];
  body?: string | null;
  at?: Date;
  templateId?: number | null; // sent from a message template (M1)
  runRules?: boolean;
};

// A "real" contact is a message/call/DM, not an internal note or a consult record.
const CONTACT_TYPES = new Set(["whatsapp", "call", "instagram", "linkedin", "email"]);

export async function logActivity(db: Db, input: ActivityInput, userId: number | null) {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const [act] = await tx
      .insert(activities)
      .values({
        leadId: input.leadId,
        type: input.type,
        direction: input.direction,
        body: blank(input.body),
        at,
        byUserId: userId,
        templateId: input.templateId ?? null,
      })
      .returning();

    if (CONTACT_TYPES.has(input.type)) {
      // COALESCE-style updates: only the first ever outbound / inbound sets the timestamp.
      if (input.direction === "out") {
        await tx
          .update(leads)
          .set({ firstContactAt: at, updatedAt: new Date() })
          .where(and(eq(leads.id, input.leadId), isNull(leads.firstContactAt)));
        // we answered: "reply to them" tasks are done
        await tx
          .update(followUps)
          .set({ doneAt: at })
          .where(and(eq(followUps.leadId, input.leadId), eq(followUps.kind, "reply"), isNull(followUps.doneAt), isNull(followUps.cancelledAt)));
      } else if (input.direction === "in") {
        await tx
          .update(leads)
          .set({ firstReplyAt: at, updatedAt: new Date() })
          .where(and(eq(leads.id, input.leadId), isNull(leads.firstReplyAt)));
        // stop rule: they answered, so the scripted follow-ups no longer apply
        await cancelCadenceFollowUps(tx, input.leadId);
        if (input.runRules !== false) await fireRules(tx as unknown as Db, { trigger: "inbound_logged", leadId: input.leadId }, userId);
      }
    }
    return act;
  });
}

export type StageResult = { ok: true } | { ok: false; error: string; missing?: Missing[] };

export type MoveOpts = {
  lostReasonId?: number | null;
  viaEnrolment?: boolean;
  paymentRef?: string | null; // for the Enrolled exit check
  nextStepDate?: Date | null; // P6: next contact date set in the same step (creates a follow-up)
  override?: string | null; // owner override of unmet exit criteria, with the reason (audit-logged)
  skipCriteria?: boolean; // system moves only (imports of historical data)
  onlyIfReady?: boolean; // automatic moves: quietly stay put when criteria are not met
};
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Every stage change goes through here so stage_events is always written.
// `viaEnrolment` is set only by enrolLead: a lead cannot become "won" without an enrolment row.
export async function moveStageTx(
  tx: Tx,
  leadId: number,
  toStage: string,
  userId: number | null,
  opts: MoveOpts = {},
): Promise<StageResult> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || lead.deletedAt) return { ok: false, error: "Lead not found" };
  const [target] = await tx.select().from(stages).where(eq(stages.key, toStage));
  if (!target) return { ok: false, error: "Unknown stage" };
  if (lead.stage === toStage) return { ok: true };

  const [current] = await tx.select().from(stages).where(eq(stages.key, lead.stage));
  if (current?.kind === "won") {
    // moving out of won would leave revenue rows pointing at a lead that is no longer enrolled
    return { ok: false, error: "Enrolled leads cannot be moved back" };
  }
  if (target.kind === "won" && !opts.viaEnrolment) return { ok: false, error: "Enrol the lead to mark it as won" };

  let lostReasonId: number | null = null;
  if (target.kind === "lost") {
    if (!opts.lostReasonId) return { ok: false, error: "A lost reason is required" };
    const [r] = await tx.select().from(lostReasons).where(eq(lostReasons.id, opts.lostReasonId));
    if (!r) return { ok: false, error: "Unknown lost reason" };
    lostReasonId = r.id;
  }

  // P1: exit criteria for the stage being entered
  if (!opts.skipCriteria) {
    const missing = await missingFor(tx, leadId, toStage, { lostReasonId, paymentRef: opts.paymentRef, nextStepDate: opts.nextStepDate });
    if (missing.length) {
      if (opts.onlyIfReady) return { ok: false, error: describeMissing(missing), missing };
      const reason = opts.override?.trim();
      if (!reason) return { ok: false, error: describeMissing(missing), missing };
      await audit(tx, { userId, entity: "lead", entityId: leadId, action: "stage_override", diff: { to: toStage, missing: missing.map((m) => m.key), reason: reason.slice(0, 500) } });
    }
  }

  const now = new Date();
  await tx
    .update(leads)
    .set({
      stage: toStage,
      lostReasonId,
      closedAt: target.kind === "lost" || target.kind === "won" ? now : null,
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));
  await tx.insert(stageEvents).values({ leadId, fromStage: lead.stage, toStage, at: now, byUserId: userId });
  if (target.kind === "won" || target.kind === "lost") await cancelCadenceFollowUps(tx, leadId); // stop rule
  if (opts.nextStepDate && (target.kind === "open" || target.kind === "nurture")) {
    await tx.insert(followUps).values({ leadId, dueAt: opts.nextStepDate, kind: "whatsapp", note: `Next step (${target.label})`, createdBy: userId });
  }
  await audit(tx, { userId, entity: "lead", entityId: leadId, action: "stage", diff: { from: lead.stage, to: toStage } });
  await fireRules(tx as unknown as Db, { trigger: "stage_changed", leadId, from: lead.stage, to: toStage, lostReasonId }, userId);
  return { ok: true };
}

export async function changeStage(
  db: Db,
  leadId: number,
  toStage: string,
  userId: number | null,
  opts: Omit<MoveOpts, "viaEnrolment"> = {},
): Promise<StageResult> {
  return db.transaction((tx) => moveStageTx(tx, leadId, toStage, userId, opts));
}

export async function updateLead(
  db: Db,
  id: number,
  patch: Partial<Omit<NewLeadInput, "phone">> & { phone?: string | null },
  userId: number | null,
): Promise<{ ok: true } | { ok: false; error: string; duplicates?: Duplicate[] }> {
  const phone = patch.phone === undefined ? undefined : blank(patch.phone) ? normalizePhone(patch.phone) : null;
  if (patch.phone !== undefined && blank(patch.phone) && !phone) return { ok: false, error: "Invalid phone number" };
  const email = patch.email === undefined ? undefined : (blank(patch.email)?.toLowerCase() ?? null);

  const duplicates = await findDuplicates(db, { phone, email }, id);
  if (duplicates.length) return { ok: false, error: "Another lead has this phone or email", duplicates };

  const set: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (patch.fullName !== undefined) set.fullName = patch.fullName.trim();
  if (phone !== undefined) {
    set.phoneWhatsapp = phone;
    set.phoneRaw = blank(patch.phone);
  }
  if (email !== undefined) set.email = email;
  if (patch.city !== undefined) set.city = blank(patch.city);
  if (patch.segment !== undefined) set.segment = patch.segment;
  if (patch.sourceId !== undefined) set.sourceId = patch.sourceId;
  if (patch.campaignId !== undefined) set.campaignId = patch.campaignId;
  if (patch.tierInterest !== undefined) set.tierInterest = patch.tierInterest;
  if (patch.notes !== undefined) set.notes = blank(patch.notes);
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;

  try {
    await db.transaction(async (tx) => {
      await tx.update(leads).set(set).where(eq(leads.id, id));
      // field names only, never values: no lead PII in the audit log
      await audit(tx, { userId, entity: "lead", entityId: id, action: "update", diff: { fields: Object.keys(set).filter((k) => k !== "updatedAt") } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "Another lead has this phone or email", duplicates: await findDuplicates(db, { phone, email }, id) };
    throw e;
  }
  return { ok: true };
}

export async function setDeleted(db: Db, id: number, deleted: boolean, userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ deletedAt: deleted ? new Date() : null, updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, { userId, entity: "lead", entityId: id, action: deleted ? "delete" : "restore" });
  });
}

// ---- offer details (P1: Consult held -> Offer sent needs tier, price, payment link sent, decision date) ----

export type OfferInput = {
  offerTier?: Lead["offerTier"];
  offerAmountEgp?: number | null;
  offerPaymentLink?: string | null;
  linkSent?: boolean; // tick = the payment link has been sent to the lead
  decisionDueAt?: Date | null;
};

export async function updateOffer(db: Db, id: number, o: OfferInput, userId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (o.offerAmountEgp != null && (!Number.isInteger(o.offerAmountEgp) || o.offerAmountEgp <= 0)) return { ok: false, error: "Price must be a whole number of EGP" };
  const link = blank(o.offerPaymentLink);
  if (link && !/^https?:\/\/\S+$/i.test(link)) return { ok: false, error: "The payment link must start with https://" };
  if (o.linkSent && !link) return { ok: false, error: "Add the payment link before marking it sent" };
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(leads).where(eq(leads.id, id)).for("update");
    if (!cur || cur.deletedAt) return { ok: false as const, error: "Lead not found" };
    await tx
      .update(leads)
      .set({
        offerTier: o.offerTier === undefined ? cur.offerTier : o.offerTier,
        offerAmountEgp: o.offerAmountEgp === undefined ? cur.offerAmountEgp : o.offerAmountEgp,
        offerPaymentLink: o.offerPaymentLink === undefined ? cur.offerPaymentLink : link,
        // keep the first "sent" time; unticking clears it
        offerSentAt: o.linkSent === undefined ? cur.offerSentAt : o.linkSent ? (cur.offerSentAt ?? new Date()) : null,
        decisionDueAt: o.decisionDueAt === undefined ? cur.decisionDueAt : o.decisionDueAt,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
    await audit(tx, { userId, entity: "lead", entityId: id, action: "offer", diff: { fields: Object.keys(o) } });
    return { ok: true as const };
  });
}

// ---- P5: weekly review of "no decision" losses: reactivate (back to Nurture with a date) or close ----

export async function closeLostReview(db: Db, id: number, userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ lostReviewedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, { userId, entity: "lead", entityId: id, action: "lost_review_closed" });
  });
}

export async function reactivateLead(db: Db, id: number, nextStepDate: Date, userId: number | null): Promise<StageResult> {
  return db.transaction(async (tx) => {
    const r = await moveStageTx(tx, id, "nurture", userId, { nextStepDate });
    if (r.ok) {
      await tx
        .update(leads)
        .set({ lostReviewedAt: new Date(), tags: sql`array_remove(${leads.tags}, 'nurture-review')` })
        .where(eq(leads.id, id));
    }
    return r;
  });
}

export async function setTags(db: Db, id: number, tags: string[], userId: number | null) {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40)).filter(Boolean))].sort().slice(0, 20);
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ tags: clean, updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, { userId, entity: "lead", entityId: id, action: "tags", diff: { tags: clean } });
  });
  return clean;
}
