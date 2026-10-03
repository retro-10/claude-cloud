import Link from "next/link";
import { taskStateAction, createTaskAction } from "@/app/(app)/tasks/actions";
import { EmptyState, Icon } from "@/components/ui";
import type { TaskRow } from "@/lib/tasks";
import { formatCairo } from "@/lib/time";

type Person = { id: number; name: string };
type Batch = { id: number; name: string };

const PRIORITY_CHIP: Record<string, string> = { high: "chip chip-danger", normal: "chip", low: "chip" };

/** The add-a-task form. On a lead or batch page the link is fixed; on the Tasks page a batch can be picked. */
export function TaskForm({ people, back, leadId, cohortId, batches, me, open = false }: { people: Person[]; back: string; leadId?: number; cohortId?: number; batches?: Batch[]; me: number; open?: boolean }) {
  const form = (
    <form action={createTaskAction} className={`grid gap-3 sm:grid-cols-2 ${open ? "" : "mt-3"}`}>
      <input type="hidden" name="back" value={back} />
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {cohortId && <input type="hidden" name="cohortId" value={cohortId} />}
      <label className="field sm:col-span-2">
        What needs doing
        <input name="title" required maxLength={200} className="input" placeholder="e.g. Book the studio for the masterclass" />
      </label>
      <label className="field">
        Who
        <select name="assigneeId" defaultValue={me} className="input">
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Due
        <input name="due" type="date" className="input" />
      </label>
      <label className="field">
        Priority
        <select name="priority" defaultValue="normal" className="input">
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </label>
      {batches && !cohortId && (
        <label className="field">
          Batch (optional)
          <select name="cohortId" defaultValue="" className="input">
            <option value="">None</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field sm:col-span-2">
        Notes
        <textarea name="notes" rows={2} maxLength={4000} className="input" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">Add task</button>
      </div>
    </form>
  );
  // open: the form on its own (the Tasks page); otherwise behind an "Add task" toggle (lead and batch pages)
  if (open) return form;
  return (
    <details className="group">
      <summary className="btn btn-secondary btn-sm w-fit cursor-pointer list-none">
        <Icon name="plus" size={14} /> Add task
      </summary>
      {form}
    </details>
  );
}

function StateButton({ id, state, back, label, icon }: { id: number; state: "done" | "reopen" | "cancel"; back: string; label: string; icon: "check" | "history" | "x" }) {
  return (
    <form action={taskStateAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="back" value={back} />
      <button className={state === "done" ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"} aria-label={`${label}: task ${id}`} title={label}>
        <Icon name={icon} size={14} />
        {state === "done" ? " Done" : ""}
      </button>
    </form>
  );
}

/** A list of tasks with one-click Done. `showLinks` adds the lead or batch each task belongs to. */
export function TaskList({ rows, back, canWrite, showLinks = true, empty = "Nothing to do here." }: { rows: TaskRow[]; back: string; canWrite: boolean; showLinks?: boolean; empty?: string }) {
  if (!rows.length) return <EmptyState icon="check" title={empty} />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => {
        const finished = !!t.doneAt || !!t.cancelledAt;
        return (
          <li key={t.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className={`flex flex-wrap items-center gap-2 text-sm ${finished ? "text-muted line-through" : "font-medium"}`}>
                {t.title}
                {t.priority !== "normal" && !finished && <span className={PRIORITY_CHIP[t.priority]}>{t.priority}</span>}
                {t.cancelledAt && <span className="chip">cancelled</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span>{t.assignee ?? "Unassigned"}</span>
                {t.dueAt && !finished && (
                  <span className={t.overdue ? "font-medium text-danger" : ""}>
                    {t.overdue ? "Overdue · " : "Due "}
                    {formatCairo(t.dueAt, false)}
                  </span>
                )}
                {t.doneAt && <span>Done {formatCairo(t.doneAt, false)}</span>}
                {showLinks && t.leadId && (
                  <Link href={`/leads/${t.leadId}`} className="link" dir="auto">
                    {t.leadName}
                  </Link>
                )}
                {showLinks && t.cohortId && (
                  <Link href={`/cohorts/${t.cohortId}`} className="link">
                    {t.cohortName}
                  </Link>
                )}
              </div>
              {t.notes && <p className="mt-1 whitespace-pre-line text-xs text-muted" dir="auto">{t.notes}</p>}
            </div>
            {canWrite && (
              <div className="flex items-center gap-1">
                {finished ? (
                  <StateButton id={t.id} state="reopen" back={back} label="Reopen" icon="history" />
                ) : (
                  <>
                    <StateButton id={t.id} state="done" back={back} label="Mark done" icon="check" />
                    <StateButton id={t.id} state="cancel" back={back} label="Cancel task" icon="x" />
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

