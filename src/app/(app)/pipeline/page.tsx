import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { cohorts, enrolments, lostReasons, stages } from "@/db/schema";
import { BoardClient } from "@/components/BoardClient";
import { getBoard } from "@/lib/pipeline";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";

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

  return (
    // "board-wide" makes the layout drop its max width (see has-[] in the layout): nine columns need
    // the full screen. No transform here: it would trap position:fixed modals.
    <div className="board-wide">
      <h1 className="mb-3 font-display text-2xl">Pipeline</h1>
      <BoardClient
        stages={stageList.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
        cards={board.cards.map((c) => ({
          ...c,
          nextFollowUp: c.nextFollowUp ? c.nextFollowUp.toISOString() : null,
        }))}
        totals={board.totals}
        lostReasons={reasons}
        cohorts={cohortRows}
        canWrite={can(user.role, "lead:write")}
        isOwner={user.role === "owner"}
      />
    </div>
  );
}
