import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { approvalRequests, ledgerEntries } from "@/db/schema";
import { APPROVAL_TYPES } from "./approvals";
import { campaignStats } from "./campaigns";
import { uncategorisedSql } from "./finance";

const MONEY = APPROVAL_TYPES.filter((t) => t.money).map((t) => t.key);

/** What needs finance's attention, for the header of the books: money waiting for a yes, approved requests still to
 * pay, costs to sort into a category, and campaigns past their budget. */
export async function financeAttention(db: Db) {
  const [[waiting], [owed], [uncat], campaigns] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, egp: sql<number>`coalesce(sum(${approvalRequests.amountEgp}), 0)::int`, oldest: sql<string | null>`min(${approvalRequests.createdAt})` })
      .from(approvalRequests)
      .where(and(inArray(approvalRequests.type, MONEY), inArray(approvalRequests.status, ["pending", "needs_info"]))),
    db
      .select({ n: sql<number>`count(*)::int`, egp: sql<number>`coalesce(sum(${ledgerEntries.amountEgp}), 0)::int` })
      .from(approvalRequests)
      .innerJoin(ledgerEntries, eq(ledgerEntries.id, approvalRequests.ledgerEntryId))
      .where(and(isNotNull(approvalRequests.ledgerEntryId), eq(ledgerEntries.status, "owed"), isNull(ledgerEntries.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries).where(and(isNull(ledgerEntries.deletedAt), uncategorisedSql)),
    campaignStats(db),
  ]);
  return {
    waiting: { count: waiting.n, egp: waiting.egp, oldest: waiting.oldest ? new Date(waiting.oldest) : null },
    owedFromRequests: { count: owed.n, egp: owed.egp },
    uncategorised: uncat.n,
    overBudget: campaigns.filter((c) => c.remainingEgp != null && c.remainingEgp < 0 && c.status !== "ended").map((c) => ({ id: c.id, label: c.label, overEgp: -c.remainingEgp! })),
    budgets: campaigns.filter((c) => c.budgetEgp != null && c.status !== "ended"),
  };
}
