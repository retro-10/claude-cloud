import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, attachments, consentRecords, consults, enrolments, eventAttendance, followUps, formSubmissions, leadMerges, leads, tasks } from "@/db/schema";
import { audit } from "./audit";

/**
 * D2/D3: merging is always a person's decision (no automatic merge). The surviving lead keeps its id and
 * stage; for each field the user picks whose value wins. Every activity, follow-up, consult, enrolment
 * and consent record of the other lead moves over, so the combined timeline has each item exactly once.
 * The other lead is soft-deleted and points at the survivor. Undo is possible for 7 days.
 */
export const MERGE_FIELDS = [
  "fullName",
  "phoneWhatsapp",
  "email",
  "city",
  "segment",
  "sourceId",
  "campaignId",
  "tierInterest",
  "ownerId",
  "offerTier",
  "offerAmountEgp",
  "offerPaymentLink",
  "decisionDueAt",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export const MERGE_LABELS: Record<MergeField, string> = {
  fullName: "Name",
  phoneWhatsapp: "WhatsApp",
  email: "Email",
  city: "City",
  segment: "Segment",
  sourceId: "Source",
  campaignId: "Campaign",
  tierInterest: "Tier interest",
  ownerId: "Owner",
  offerTier: "Offer tier",
  offerAmountEgp: "Offer price",
  offerPaymentLink: "Payment link",
  decisionDueAt: "Decision date",
};

export const UNDO_DAYS = 7;
type Lead = typeof leads.$inferSelect;
export type MergeResult = { ok: true; mergeId: number } | { ok: false; error: string };

// Children that move with the person. stage_events stay on their own lead: the funnel counts each lead's
// own history, and the merged-away lead is excluded from metrics once deleted.
const CHILDREN = { activities, followUps, consults, enrolments, consentRecords, tasks, attachments, formSubmissions, eventAttendance } as const;
type ChildKey = keyof typeof CHILDREN;

const minDate = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));

export async function mergeLeads(
  db: Db,
  input: { survivorId: number; loserId: number; pick: Partial<Record<MergeField, "survivor" | "loser">>; combineNotes?: boolean },
  userId: number | null,
): Promise<MergeResult> {
  if (input.survivorId === input.loserId) return { ok: false, error: "Pick two different leads" };
  return db.transaction(async (tx): Promise<MergeResult> => {
    const rows = await tx.select().from(leads).where(inArray(leads.id, [input.survivorId, input.loserId])).for("update");
    const s = rows.find((r) => r.id === input.survivorId);
    const l = rows.find((r) => r.id === input.loserId);
    if (!s || !l || s.deletedAt || l.deletedAt) return { ok: false, error: "Both leads must exist and not be deleted" };

    const [se, le] = await Promise.all([
      tx.select({ cohortId: enrolments.cohortId }).from(enrolments).where(eq(enrolments.leadId, s.id)),
      tx.select({ cohortId: enrolments.cohortId }).from(enrolments).where(eq(enrolments.leadId, l.id)),
    ]);
    if (se.some((a) => le.some((b) => b.cohortId === a.cohortId))) return { ok: false, error: "Both leads are enrolled in the same cohort: fix the payments first" };

    const set: Partial<Lead> = {};
    for (const f of MERGE_FIELDS) {
      if (input.pick[f] === "loser") (set as Record<string, unknown>)[f] = l[f];
    }
    if (input.combineNotes && l.notes) set.notes = [s.notes, l.notes].filter(Boolean).join("\n\n— merged —\n");
    set.tags = [...new Set([...s.tags, ...l.tags])].sort();
    set.doNotContact = s.doNotContact || l.doNotContact;
    set.firstContactAt = minDate(s.firstContactAt, l.firstContactAt);
    set.firstReplyAt = minDate(s.firstReplyAt, l.firstReplyAt);
    set.createdAt = minDate(s.createdAt, l.createdAt)!;
    set.updatedAt = new Date();

    // phone is unique across all rows: free it on the lead that is going away first
    await tx.update(leads).set({ phoneWhatsapp: null, deletedAt: new Date(), mergedIntoId: s.id, updatedAt: new Date() }).where(eq(leads.id, l.id));
    await tx.update(leads).set(set).where(eq(leads.id, s.id));

    // both registered for the same event: keep the survivor's row, carrying over "came" and "reminded",
    // and drop the other so the move below does not break the one-row-per-event rule
    await tx.execute(sql`update event_attendance s set
        attended = case when s.attended or o.attended then true when s.attended is null then o.attended else s.attended end,
        reminded_at = least(s.reminded_at, o.reminded_at)
      from event_attendance o where o.lead_id = ${l.id} and s.lead_id = ${s.id} and o.campaign_id = s.campaign_id`);
    await tx.execute(sql`delete from event_attendance where lead_id = ${l.id} and campaign_id in (select campaign_id from event_attendance where lead_id = ${s.id})`);

    const moved: Record<string, number[]> = {};
    for (const [key, table] of Object.entries(CHILDREN) as [ChildKey, (typeof CHILDREN)[ChildKey]][]) {
      const r = await tx.update(table).set({ leadId: s.id }).where(eq(table.leadId, l.id)).returning({ id: table.id });
      moved[key] = r.map((x) => x.id);
    }

    const [m] = await tx
      .insert(leadMerges)
      .values({ survivorId: s.id, loserId: l.id, survivorBefore: s, loserBefore: l, moved, byUserId: userId })
      .returning({ id: leadMerges.id });
    await audit(tx, { userId, entity: "lead", entityId: s.id, action: "merge", diff: { mergedLeadId: l.id, mergeId: m.id, fromLoser: MERGE_FIELDS.filter((f) => input.pick[f] === "loser") } });
    return { ok: true, mergeId: m.id };
  });
}

const revive = (j: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...j };
  for (const k of ["createdAt", "updatedAt", "firstContactAt", "firstReplyAt", "closedAt", "deletedAt", "offerSentAt", "decisionDueAt", "lostReviewedAt"]) {
    if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
  }
  delete out.id;
  return out as Partial<Lead>;
};

export async function undoMerge(db: Db, mergeId: number, userId: number | null, now = new Date()): Promise<MergeResult> {
  return db.transaction(async (tx): Promise<MergeResult> => {
    const [m] = await tx.select().from(leadMerges).where(eq(leadMerges.id, mergeId)).for("update");
    if (!m || m.undoneAt) return { ok: false, error: "Nothing to undo" };
    if (now.getTime() - m.mergedAt.getTime() > UNDO_DAYS * 86_400_000) return { ok: false, error: `Merges can only be undone within ${UNDO_DAYS} days` };

    const before = revive(m.survivorBefore as Record<string, unknown>);
    const loserBefore = revive(m.loserBefore as Record<string, unknown>);
    // survivor first: it gives back any phone it took from the other lead
    await tx.update(leads).set({ ...before, updatedAt: now }).where(eq(leads.id, m.survivorId));
    await tx.update(leads).set({ ...loserBefore, deletedAt: null, mergedIntoId: null, updatedAt: now }).where(eq(leads.id, m.loserId));
    for (const [key, ids] of Object.entries(m.moved)) {
      const table = CHILDREN[key as ChildKey];
      if (table && ids.length) await tx.update(table).set({ leadId: m.loserId }).where(and(inArray(table.id, ids), eq(table.leadId, m.survivorId)));
    }
    await tx.update(leadMerges).set({ undoneAt: now }).where(eq(leadMerges.id, m.id));
    await audit(tx, { userId, entity: "lead", entityId: m.survivorId, action: "merge_undo", diff: { mergeId: m.id, restoredLeadId: m.loserId } });
    return { ok: true, mergeId: m.id };
  });
}

/** Merges on this lead that can still be undone. */
export async function undoableMerges(db: Pick<Db, "select">, leadId: number, now = new Date()) {
  const rows = await db
    .select()
    .from(leadMerges)
    .where(and(eq(leadMerges.survivorId, leadId), isNull(leadMerges.undoneAt)))
    .orderBy(desc(leadMerges.mergedAt));
  return rows.filter((r) => now.getTime() - r.mergedAt.getTime() <= UNDO_DAYS * 86_400_000);
}

/** Likely duplicates of a lead, for the merge picker: same name (Arabic variants folded), same email, or same last 8 phone digits. */
export async function duplicateCandidates(db: Db, leadId: number, limit = 8) {
  const rows = (await db.execute(sql`
    select c.id, c.full_name, c.phone_whatsapp, c.email, c.city, c.stage
    from leads l join leads c on c.id <> l.id and c.deleted_at is null
    where l.id = ${leadId} and (
      translate(lower(c.full_name), 'أإآٱىة', 'اااايه') = translate(lower(l.full_name), 'أإآٱىة', 'اااايه')
      or (l.email is not null and lower(c.email) = lower(l.email))
      or (l.phone_whatsapp is not null and right(c.phone_whatsapp, 8) = right(l.phone_whatsapp, 8)))
    order by c.updated_at desc limit ${limit}`)) as unknown as { id: number; full_name: string; phone_whatsapp: string | null; email: string | null; city: string | null; stage: string }[];
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, phone: r.phone_whatsapp, email: r.email, city: r.city, stage: r.stage }));
}
