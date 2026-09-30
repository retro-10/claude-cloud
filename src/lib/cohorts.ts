import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cohorts, enrolments, leads } from "@/db/schema";
import { audit } from "./audit";
import { dueSql, listCandidates } from "./finance";

export type CohortInput = {
  name: string;
  seatCap: number;
  masterclassAt?: Date | null;
  enrolmentCloseAt?: Date | null;
  startAt?: Date | null;
  openAt?: Date | null;
  status?: (typeof cohorts.$inferInsert)["status"];
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
      openAt: input.openAt ?? null,
      status: input.status ?? "planning",
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
        openAt: input.openAt ?? null,
        status: input.status ?? c.status,
        updatedAt: new Date(),
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
  openAt: Date | null;
  status: "planning" | "live" | "closed";
  revenueEgp: number; // what the students owe in total (price − discount; free seats 0)
  collectedEgp: number; // received payments linked to the batch's students
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
      openAt: cohorts.openAt,
      status: cohorts.status,
      seatsUsed: sql<number>`count(${enrolments.id})::int`,
      revenueEgp: sql<number>`coalesce(sum(${dueSql}), 0)::int`,
      collectedEgp: sql<number>`coalesce((select sum(case when x.category = 'Refund' then -x.amount_egp else x.amount_egp end) from ledger_entries x
        join enrolments xe on xe.id = x.enrolment_id where xe.cohort_id = ${cohorts.id} and x.deleted_at is null
        and x.section = 'income' and x.status = 'received'), 0)::int`,
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
  const students = await listCandidates(db, { cohortId: id });
  const byTier: Record<string, { count: number; egp: number }> = {};
  for (const s of students) {
    byTier[s.tier] ??= { count: 0, egp: 0 };
    byTier[s.tier].count++;
    byTier[s.tier].egp += s.due;
  }
  return { summary, students, byTier };
}
