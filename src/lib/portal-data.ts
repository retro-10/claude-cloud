import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { batchClasses, certificates, enrolments, ledgerEntries } from "@/db/schema";
import { studentAssignments } from "./assignments";
import { attendanceSummary } from "./classes";
import { listCandidates } from "./finance";

/** A student's own payments: received and expected, refunds shown as such. */
const myPayments = (db: Db, enrolmentId: number) =>
  db
    .select({ id: ledgerEntries.id, amountEgp: ledgerEntries.amountEgp, status: ledgerEntries.status, category: ledgerEntries.category, date: sql<Date>`coalesce(${ledgerEntries.date}, ${ledgerEntries.createdAt})` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.enrolmentId, enrolmentId), isNull(ledgerEntries.deletedAt), eq(ledgerEntries.section, "income"), sql`${ledgerEntries.status} in ('received', 'expected')`))
    .orderBy(desc(sql`coalesce(${ledgerEntries.date}, ${ledgerEntries.createdAt})`));

/** Everything a student may see about themselves, and nothing about anyone else. */
export async function portalOverview(db: Db, leadId: number) {
  const mine = (await listCandidates(db, { leadId })).filter((c) => c.status !== "dropped");
  return Promise.all(
    mine.map(async (c) => {
      const [classes, attendance, work, [cert], payments] = await Promise.all([
        db
          .select()
          .from(batchClasses)
          .where(and(eq(batchClasses.cohortId, c.cohortId), isNull(batchClasses.deletedAt)))
          .orderBy(batchClasses.startsAt),
        attendanceSummary(db, c.cohortId),
        studentAssignments(db, c.enrolmentId),
        db.select().from(certificates).where(and(eq(certificates.enrolmentId, c.enrolmentId), isNull(certificates.revokedAt))),
        myPayments(db, c.enrolmentId),
      ]);
      const now = new Date();
      return {
        enrolment: c,
        upcoming: classes.filter((x) => x.startsAt >= new Date(now.getTime() - x.durationMin * 60_000)).slice(0, 6),
        past: classes.filter((x) => x.startsAt < now).reverse(),
        attendance: attendance.get(c.enrolmentId) ?? null,
        work,
        certificate: cert ?? null,
        payments,
      };
    }),
  );
}

export async function ownCertificate(db: Db, leadId: number, code: string) {
  const [row] = await db
    .select({ c: certificates })
    .from(certificates)
    .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
    .where(and(eq(enrolments.leadId, leadId), eq(certificates.code, code.toUpperCase()), isNull(certificates.revokedAt)));
  return row?.c ?? null;
}

