import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, leads, lostReasons, stageEvents, stages } from "@/db/schema";
import { audit } from "./audit";
import { cancelCadenceFollowUps } from "./followups";
import { normalizePhone } from "./phone";

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
};

export type Duplicate = { id: number; fullName: string; deleted: boolean; matchedOn: "phone" | "email" };

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

export type CreateResult =
  | { ok: true; lead: Lead }
  | { ok: false; error: "duplicate"; duplicates: Duplicate[] }
  | { ok: false; error: "invalid_phone" };

export async function createLead(db: Db, input: NewLeadInput, userId: number | null): Promise<CreateResult> {
  const phone = blank(input.phone) ? normalizePhone(input.phone) : null;
  if (blank(input.phone) && !phone) return { ok: false, error: "invalid_phone" };

  const duplicates = await findDuplicates(db, { phone, email: input.email });
  if (duplicates.length) return { ok: false, error: "duplicate", duplicates };

  const lead = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({
        fullName: input.fullName.trim(),
        phoneWhatsapp: phone,
        email: blank(input.email)?.toLowerCase() ?? null,
        city: blank(input.city),
        segment: input.segment ?? null,
        sourceId: input.sourceId ?? null,
        campaignId: input.campaignId ?? null,
        tierInterest: input.tierInterest ?? "unsure",
        notes: blank(input.notes),
        ownerId: input.ownerId ?? userId,
      })
      .returning();
    // creation is the funnel's first event (from_stage NULL -> new)
    await tx.insert(stageEvents).values({ leadId: row.id, fromStage: null, toStage: "new", byUserId: userId });
    await audit(tx, { userId, entity: "lead", entityId: row.id, action: "create" });
    return row;
  });
  return { ok: true, lead };
}

export type ActivityInput = {
  leadId: number;
  type: (typeof activities.$inferInsert)["type"];
  direction: (typeof activities.$inferInsert)["direction"];
  body?: string | null;
  at?: Date;
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
      })
      .returning();

    if (CONTACT_TYPES.has(input.type)) {
      // COALESCE-style updates: only the first ever outbound / inbound sets the timestamp.
      if (input.direction === "out") {
        await tx
          .update(leads)
          .set({ firstContactAt: at, updatedAt: new Date() })
          .where(and(eq(leads.id, input.leadId), isNull(leads.firstContactAt)));
      } else if (input.direction === "in") {
        await tx
          .update(leads)
          .set({ firstReplyAt: at, updatedAt: new Date() })
          .where(and(eq(leads.id, input.leadId), isNull(leads.firstReplyAt)));
        // stop rule: they answered, so the scripted follow-ups no longer apply
        await cancelCadenceFollowUps(tx, input.leadId);
      }
    }
    return act;
  });
}

export type StageResult = { ok: true } | { ok: false; error: string };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Every stage change goes through here so stage_events is always written.
// `viaEnrolment` is set only by enrolLead: a lead cannot become "won" without an enrolment row.
export async function moveStageTx(
  tx: Tx,
  leadId: number,
  toStage: string,
  userId: number | null,
  opts: { lostReasonId?: number | null; viaEnrolment?: boolean } = {},
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
  await audit(tx, { userId, entity: "lead", entityId: leadId, action: "stage", diff: { from: lead.stage, to: toStage } });
  return { ok: true };
}

export async function changeStage(
  db: Db,
  leadId: number,
  toStage: string,
  userId: number | null,
  opts: { lostReasonId?: number | null } = {},
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
  if (phone !== undefined) set.phoneWhatsapp = phone;
  if (email !== undefined) set.email = email;
  if (patch.city !== undefined) set.city = blank(patch.city);
  if (patch.segment !== undefined) set.segment = patch.segment;
  if (patch.sourceId !== undefined) set.sourceId = patch.sourceId;
  if (patch.campaignId !== undefined) set.campaignId = patch.campaignId;
  if (patch.tierInterest !== undefined) set.tierInterest = patch.tierInterest;
  if (patch.notes !== undefined) set.notes = blank(patch.notes);
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;

  await db.transaction(async (tx) => {
    await tx.update(leads).set(set).where(eq(leads.id, id));
    // field names only, never values: no lead PII in the audit log
    await audit(tx, { userId, entity: "lead", entityId: id, action: "update", diff: { fields: Object.keys(set).filter((k) => k !== "updatedAt") } });
  });
  return { ok: true };
}

export async function setDeleted(db: Db, id: number, deleted: boolean, userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ deletedAt: deleted ? new Date() : null, updatedAt: new Date() }).where(eq(leads.id, id));
    await audit(tx, { userId, entity: "lead", entityId: id, action: deleted ? "delete" : "restore" });
  });
}
