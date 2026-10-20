import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Dot, DueDate, StatusPill } from "@/components/hq/bits";
import { Card, Icon } from "@/components/ui";
import { listSpaces, taskDetail } from "@/lib/hq";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { TASK_PRIORITIES } from "@/lib/tasks";
import { cairoYmd, formatCairo } from "@/lib/time";
import { quickTaskAction, saveTaskDetailsAction } from "../../hq/actions";
import { taskStateAction } from "../actions";

export const metadata = { title: "Task" };

const ACTION_LABEL: Record<string, string> = {
  create: "created the task",
  update: "edited it",
  move: "moved it",
  done: "marked it done",
  reopen: "reopened it",
  cancel: "cancelled it",
};

export default async function TaskPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  if (!/^\d+$/.test(id)) notFound();
  const [t, spaces, people] = await Promise.all([
    taskDetail(db, Number(id)),
    listSpaces(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  if (!t) notFound();
  const canWrite = can(user.role, "task:write") && !t.cancelledAt;
  const back = `/tasks/${t.id}`;
  const statuses = t.space?.statuses ?? [];
  const status = statuses.find((s) => s.key === t.status);
  const finished = !!t.doneAt || !!t.cancelledAt;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {t.space && t.list ? (
          <>
            <Link href="/hq" className="hover:text-fg">
              HQ
            </Link>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <Link href={`/spaces/${t.space.id}`} className="hover:text-fg">
              {t.space.name}
            </Link>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <Link href={`/spaces/${t.space.id}?list=${t.list.id}`} className="hover:text-fg">
              {t.list.name}
            </Link>
          </>
        ) : (
          <Link href="/tasks" className="hover:text-fg">
            Tasks
          </Link>
        )}
        {t.parent && (
          <>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <Link href={`/tasks/${t.parent.id}`} className="hover:text-fg">
              {t.parent.title}
            </Link>
          </>
        )}
      </nav>
      <Flash notice={sp.notice} error={sp.error} />

      <form action={saveTaskDetailsAction} id="task-form" className="contents">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="back" value={back} />
      </form>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex items-start gap-3">
            <div className="pt-3">{status ? <Dot color={status.color} size={14} ring={status.group === "todo"} /> : <Icon name="check" className="text-accent" />}</div>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="task-title">
                Title
              </label>
              <input
                id="task-title"
                form="task-form"
                name="title"
                defaultValue={t.title}
                required
                maxLength={200}
                readOnly={!canWrite}
                className={`w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-[26px] font-semibold leading-tight tracking-tight hover:border-line focus:border-brand/60 focus:outline-none ${t.doneAt ? "text-muted line-through" : ""}`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 px-2 text-xs text-muted">
                {status && <StatusPill status={status} />}
                {t.cancelledAt && <span className="chip chip-danger">Cancelled</span>}
                <span>
                  Created by {t.creator ?? "the system"} on {formatCairo(t.createdAt, false)}
                </span>
                {t.leadId && (
                  <Link href={`/leads/${t.leadId}`} className="chip hover:text-fg">
                    <Icon name="leads" size={12} /> {t.leadName}
                  </Link>
                )}
                {t.cohortId && (
                  <Link href={`/cohorts/${t.cohortId}`} className="chip hover:text-fg">
                    <Icon name="cohorts" size={12} /> {t.cohortName}
                  </Link>
                )}
              </div>
            </div>
          </div>

          <Card title="Description" icon="note">
            <label className="sr-only" htmlFor="task-notes">
              Description
            </label>
            <textarea
              id="task-notes"
              form="task-form"
              name="notes"
              rows={6}
              maxLength={4000}
              defaultValue={t.notes ?? ""}
              readOnly={!canWrite}
              placeholder="What done looks like, links, context…"
              className="input"
            />
            {canWrite && (
              <div className="mt-3 flex justify-end">
                <button form="task-form" className="btn btn-primary btn-sm">
                  Save
                </button>
              </div>
            )}
          </Card>

          {!t.parentId && (
            <Card title={`Subtasks${t.subtasks.length ? ` · ${t.subtasks.filter((s) => s.doneAt).length}/${t.subtasks.length}` : ""}`} icon="list" bodyClass="p-0">
              {t.subtasks.length > 0 && (
                <ul className="divide-y divide-line/70">
                  {t.subtasks.map((s) => {
                    const st = statuses.find((x) => x.key === s.status);
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-5 py-2.5">
                        {canWrite ? (
                          <form action={taskStateAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="state" value={s.doneAt ? "reopen" : "done"} />
                            <input type="hidden" name="back" value={back} />
                            <button
                              className={`grid h-5 w-5 place-items-center rounded-full border-2 transition ${s.doneAt ? "border-ok bg-ok/20 text-ok" : "border-faint hover:border-ok"}`}
                              aria-label={s.doneAt ? `Reopen ${s.title}` : `Mark ${s.title} done`}
                            >
                              {s.doneAt && <Icon name="check" size={11} />}
                            </button>
                          </form>
                        ) : (
                          <Dot color={st?.color ?? "slate"} />
                        )}
                        <Link href={`/tasks/${s.id}`} className={`min-w-0 flex-1 truncate text-sm hover:text-accent ${s.doneAt ? "text-muted line-through" : ""}`}>
                          {s.title}
                        </Link>
                        {st && <StatusPill status={st} />}
                        <span className="hidden text-xs text-muted sm:inline">{s.assignee ?? "Nobody"}</span>
                        <DueDate due={s.dueAt} done={!!s.doneAt} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {canWrite && (
                <form action={quickTaskAction} className="flex items-center gap-2 border-t border-line/70 px-4 py-2">
                  <input type="hidden" name="parentId" value={t.id} />
                  <input type="hidden" name="back" value={back} />
                  <Icon name="plus" size={14} className="text-muted" />
                  <label className="sr-only" htmlFor="sub-title">
                    New subtask
                  </label>
                  <input id="sub-title" name="title" required maxLength={200} placeholder="Add a subtask and press Enter" className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted focus:outline-none" />
                </form>
              )}
            </Card>
          )}

          <Card title="Activity" icon="history" bodyClass="p-0">
            <ol className="flex flex-col">
              {t.history.map((h) => (
                <li key={h.id} className="flex items-start gap-3 border-b border-line/50 px-5 py-3 last:border-0">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-faint" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{h.who ?? "Someone"}</span> {ACTION_LABEL[h.action] ?? h.action}
                    {h.action === "move" && typeof h.diff === "object" && h.diff && "status" in h.diff && (
                      <> to {statuses.find((s) => s.key === (h.diff as { status: string }).status)?.label ?? String((h.diff as { status: string }).status)}</>
                    )}
                  </span>
                  <time className="shrink-0 text-xs text-muted" dateTime={h.at.toISOString()}>
                    {formatCairo(h.at)}
                  </time>
                </li>
              ))}
              {!t.history.length && <li className="px-5 py-4 text-sm text-muted">Nothing recorded yet.</li>}
            </ol>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card title="Details" icon="settings">
            <div className="flex flex-col gap-4">
              {statuses.length > 0 && (
                <label className="field">
                  Status
                  <select form="task-form" name="status" defaultValue={t.status ?? ""} disabled={!canWrite} className="input input-sm">
                    {statuses.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!t.parentId && (
                <label className="field">
                  List
                  <select form="task-form" name="listId" defaultValue={t.list?.id ?? ""} disabled={!canWrite} className="input input-sm">
                    {!t.list && <option value="">Not in a list</option>}
                    {spaces.map((s) => (
                      <optgroup key={s.id} label={s.name}>
                        {s.lists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Assignee
                <select form="task-form" name="assigneeId" defaultValue={t.assigneeId ?? ""} disabled={!canWrite} className="input input-sm">
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Priority
                <select form="task-form" name="priority" defaultValue={t.priority} disabled={!canWrite} className="input input-sm">
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">
                  Start
                  <input form="task-form" type="date" name="start" defaultValue={t.startAt ? cairoYmd(t.startAt) : ""} disabled={!canWrite} className="input input-sm" />
                </label>
                <label className="field">
                  Due
                  <input form="task-form" type="date" name="due" defaultValue={t.dueAt ? cairoYmd(t.dueAt) : ""} disabled={!canWrite} className="input input-sm" />
                </label>
              </div>
              <label className="field">
                Tags (comma separated)
                <input form="task-form" name="tags" defaultValue={t.tags.join(", ")} maxLength={300} disabled={!canWrite} placeholder="launch, design" className="input input-sm" />
              </label>
              {canWrite && (
                <button form="task-form" className="btn btn-primary btn-sm">
                  Save details
                </button>
              )}
            </div>
          </Card>
          {can(user.role, "task:write") && (
            <Card title="Finish" icon="check">
              <div className="flex flex-wrap gap-2">
                {(finished ? [["reopen", "Reopen"]] : [["done", "Mark done"], ["cancel", "Cancel task"]]).map(([state, label]) => (
                  <form key={state} action={taskStateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="state" value={state} />
                    <input type="hidden" name="back" value={back} />
                    <button className={state === "done" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>{label}</button>
                  </form>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
