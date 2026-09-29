import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads } from "@/db/schema";
import { audit } from "./audit";

export type CohortInput = {
  name: string;
  seatCap: number;
  masterclassAt?: Date | null;
  enrolmentCloseAt?: Date | null;
  startAt?: Date | null;
};

export async function createCohort(db: Db, input: CohortInput, userId: number | null) {
  const [row] = await db
    .insert(cohorts)
    .values({
      name: input.name.trim(),
      seatCap: input.seatCap,
      masterclassAt: input.masterclassAt ?? null,
      enrolmentCloseAt: input.enrolmentCloseAt ?? null,
      startAt: input.startAt ?? null,
    })
    .returning();
  await audit(db, { userId, entity: "cohort", entityId: row.id, action: "create" });
  return row;
}

export async function updateCohort(
  db: Db,
  id: number,
  input: CohortInput,
  userId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(cohorts).where(eq(cohorts.id, id)).for("update");
    if (!c) return { ok: false as const, error: "Cohort not found" };
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(enrolments).where(eq(enrolments.cohortId, id));
    // lowering the cap below the seats already taken would silently create an over-cap cohort
    if (input.seatCap < n) return { ok: false as const, error: `${n} seats are already taken; the cap cannot be lower` };
    await tx
      .update(cohorts)
      .set({
        name: input.name.trim(),
        seatCap: input.seatCap,
        masterclassAt: input.masterclassAt ?? null,
        enrolmentCloseAt: input.enrolmentCloseAt ?? null,
        startAt: input.startAt ?? null,
      })
      .where(eq(cohorts.id, id));
    await audit(tx, { userId, entity: "cohort", entityId: id, action: "update" });
    return { ok: true as const };
  });
}

export type CohortSummary = {
  id: number;
  name: string;
  seatCap: number;
  seatsUsed: number;
  masterclassAt: Date | null;
  enrolmentCloseAt: Date | null;
  startAt: Date | null;
  revenueEgp: number; // sum of enrolment amounts (booked)
  collectedEgp: number; // of which paid_at is set
};

export async function listCohorts(db: Db): Promise<CohortSummary[]> {
  const rows = await db
    .select({
      id: cohorts.id,
      name: cohorts.name,
      seatCap: cohorts.seatCap,
      masterclassAt: cohorts.masterclassAt,
      enrolmentCloseAt: cohorts.enrolmentCloseAt,
      startAt: cohorts.startAt,
      seatsUsed: sql<number>`count(${enrolments.id})::int`,
      revenueEgp: sql<number>`coalesce(sum(${enrolments.amountEgp}), 0)::int`,
      collectedEgp: sql<number>`coalesce(sum(${enrolments.amountEgp}) filter (where ${enrolments.paidAt} is not null), 0)::int`,
    })
    .from(cohorts)
    .leftJoin(enrolments, eq(enrolments.cohortId, cohorts.id))
    .groupBy(cohorts.id)
    .orderBy(desc(cohorts.id));
  return rows;
}

export async function getCohort(db: Db, id: number) {
  const [summary] = (await listCohorts(db)).filter((c) => c.id === id);
  if (!summary) return null;
  const students = await db
    .select({
      enrolmentId: enrolments.id,
      leadId: leads.id,
      fullName: leads.fullName,
      phone: leads.phoneWhatsapp,
      email: leads.email,
      tier: enrolments.tier,
      amountEgp: enrolments.amountEgp,
      paidAt: enrolments.paidAt,
      paymentRef: enrolments.paymentRef,
      gateway: enrolments.gateway,
      createdAt: enrolments.createdAt,
    })
    .from(enrolments)
    .innerJoin(leads, eq(leads.id, enrolments.leadId))
    .where(eq(enrolments.cohortId, id))
    .orderBy(asc(enrolments.id));
  const byTier: Record<string, { count: number; egp: number }> = {};
  for (const s of students) {
    byTier[s.tier] ??= { count: 0, egp: 0 };
    byTier[s.tier].count++;
    byTier[s.tier].egp += s.amountEgp;
  }
  return { summary, students, byTier };
}

export type PaymentPatch = {
  tier?: (typeof enrolments.$inferInsert)["tier"];
  amountEgp?: number;
  paidAt?: Date | null;
  paymentRef?: string | null;
  gateway?: (typeof enrolments.$inferInsert)["gateway"];
};

// Payment details on an existing enrolment. Cohort and lead never change here.
export async function updateEnrolmentPayment(db: Db, enrolmentId: number, patch: PaymentPatch, userId: number | null) {
  if (patch.amountEgp !== undefined && (!Number.isInteger(patch.amountEgp) || patch.amountEgp <= 0)) {
    return { ok: false as const, error: "Amount must be a whole number of EGP above zero" };
  }
  const set: Partial<typeof enrolments.$inferInsert> = {};
  if (patch.tier !== undefined) set.tier = patch.tier;
  if (patch.amountEgp !== undefined) set.amountEgp = patch.amountEgp;
  if (patch.paidAt !== undefined) set.paidAt = patch.paidAt;
  if (patch.paymentRef !== undefined) set.paymentRef = patch.paymentRef?.trim() || null;
  if (patch.gateway !== undefined) set.gateway = patch.gateway;
  const rows = await db.update(enrolments).set(set).where(eq(enrolments.id, enrolmentId)).returning({ id: enrolments.id });
  if (!rows.length) return { ok: false as const, error: "Enrolment not found" };
  await audit(db, { userId, entity: "enrolment", entityId: enrolmentId, action: "payment_update", diff: { fields: Object.keys(set) } });
  return { ok: true as const };
}
