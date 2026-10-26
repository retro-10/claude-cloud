import Link from "next/link";
import { closeDecisionAction } from "@/app/(app)/team/actions";
import { EmptyState } from "@/components/ui";
import { DECISION_STATUS, type DecisionRow } from "@/lib/operations";
import { formatCairo } from "@/lib/time";

/** Decisions with their owner and date; the owner (or an owner of the business) closes them with what happened. */
export function DecisionList({ rows, me, manage, back, showMeeting = true }: { rows: DecisionRow[]; me: number; manage: boolean; back: string; showMeeting?: boolean }) {
  if (!rows.length) return <EmptyState icon="flag" title="No decisions." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => {
        const mayClose = manage || d.ownerId === me;
        return (
          <li key={d.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`font-medium ${d.status === "open" ? "" : "text-muted"}`} dir="auto">
                {d.title}
              </span>
              <span className={d.status === "open" ? (d.overdue ? "chip chip-danger" : "chip chip-brand") : d.status === "done" ? "chip chip-ok" : "chip"}>
                {d.overdue ? "overdue" : DECISION_STATUS[d.status]}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {d.owner ?? "no owner"}
              {d.dueAt ? ` · by ${formatCairo(d.dueAt, false)}` : ""}
              {showMeeting && d.meeting ? (
                <>
                  {" · from "}
                  <Link href={`/team/meetings/${d.meetingId}`} className="link">
                    {d.meeting}
                  </Link>
                </>
              ) : null}
            </div>
            {d.detail && (
              <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">
                {d.detail}
              </p>
            )}
            {d.outcome && (
              <p className="mt-1 text-sm text-muted" dir="auto">
                Outcome: {d.outcome}
              </p>
            )}
            {mayClose && d.status === "open" && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-muted">Close it</summary>
                <form action={closeDecisionAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="back" value={back} />
                  <label className="field min-w-0 flex-1">
                    What happened
                    <input name="outcome" maxLength={2000} dir="auto" className="input input-sm" />
                  </label>
                  <button name="status" value="done" className="btn btn-secondary btn-sm">
                    Done
                  </button>
                  <button name="status" value="dropped" className="btn btn-ghost btn-sm">
                    Drop it
                  </button>
                </form>
              </details>
            )}
            {mayClose && d.status !== "open" && (
              <form action={closeDecisionAction} className="mt-1">
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="back" value={back} />
                <button name="status" value="open" className="text-xs text-muted underline-offset-2 hover:underline">
                  Reopen
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
