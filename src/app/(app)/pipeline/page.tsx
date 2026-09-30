import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { cohorts, enrolments, lostReasons, stages } from "@/db/schema";
import Link from "next/link";
import { BoardClient } from "@/components/BoardClient";
import { Icon, PageHeader } from "@/components/ui";
import { getBoard } from "@/lib/pipeline";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const user = await requireUser();
  const [board, stageList, reasons, cohortRows] = await Promise.all([
    getBoard(db),
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.id)),
    db
      .select({
        id: cohorts.id,
        name: cohorts.name,
        seatCap: cohorts.seatCap,
        used: sql<number>`(select count(*)::int from ${enrolments} e where e.cohort_id = ${cohorts.id})`,
      })
      .from(cohorts)
      .orderBy(asc(cohorts.id)),
  ]);

  const open = stageList.filter((s) => s.kind === "open").map((s) => s.key);
  const openCount = open.reduce((n, k) => n + (board.totals[k] ?? 0), 0);
  const openValue = open.reduce((n, k) => n + (board.values[k] ?? 0), 0);
  const flagged = board.cards.filter((c) => c.neglected || c.stale || c.noNextStep).length;

  return (
    // "board-wide" makes the layout drop its max width: nine columns need the full screen.
    // No transform on this wrapper: it would trap position:fixed dialogs.
    <div className="board-wide">
      <PageHeader
        eyebrow="Work"
        title="Pipeline"
        subtitle={
          <span className="num">
            {openCount} open leads
            {openValue > 0 ? ` · ${new Intl.NumberFormat("en-US").format(openValue)} EGP in offers` : ""}
            {flagged > 0 ? ` · ${flagged} need attention` : ""}
          </span>
        }
        actions={
          <Link href="/settings/pipeline" className="btn btn-ghost btn-sm">
            <Icon name="flag" size={14} /> Stage rules
          </Link>
        }
      />
      <BoardClient
        stages={stageList.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
        cards={board.cards.map((c) => ({
          ...c,
          nextFollowUp: c.nextFollowUp ? c.nextFollowUp.toISOString() : null,
          decisionDueAt: c.decisionDueAt ? c.decisionDueAt.toISOString() : null,
        }))}
        totals={board.totals}
        values={board.values}
        lostReasons={reasons}
        cohorts={cohortRows}
        canWrite={can(user.role, "lead:write")}
        isOwner={user.role === "owner"}
        canOverride={can(user.role, "stage:override")}
      />
    </div>
  );
}
