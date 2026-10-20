import Link from "next/link";
import { moveTaskFormAction, patchTaskAction, quickTaskAction } from "@/app/(app)/hq/actions";
import type { HqTask, SpaceStatus } from "@/lib/hq";
import { addDaysYmd, cairoYmd, formatCairo } from "@/lib/time";
import { Icon } from "../ui/Icon";
import { AutoSelect } from "./AutoSubmit";
import { DueDate, Dot, PriorityFlag, StatusPill } from "./bits";

// The server-rendered HQ views. The Board is a client component (drag and drop): see HqBoard.

type Person = { id: number; name: string };
type ListLite = { id: number; name: string };
export type Group = "status" | "assignee" | "priority" | "list";

const PRIORITIES = [
  ["urgent", "Urgent"],
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"],
] as const;

/**
 * The "+ Add task" row. It starts the task in the list, status and day it was typed in; when the view shows every
 * list, it asks which one.
 */
export function QuickAddRow({ back, lists, listId, status, due, compact = false }: {
  back: string;
  lists: ListLite[];
  listId?: number;
  status?: string;
  due?: string;
  compact?: boolean;
}) {
  if (!lists.length) return null;
  return (
    <form action={quickTaskAction} className="flex min-w-0 items-center gap-2">
      <input type="hidden" name="back" value={back} />
      {status && <input type="hidden" name="status" value={status} />}
      {due && <input type="hidden" name="due" value={due} />}
      {listId ? (
        <input type="hidden" name="listId" value={listId} />
      ) : (
        <select name="listId" aria-label="List" className="input input-xs w-32 shrink-0" defaultValue={lists[0].id}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      <Icon name="plus" size={14} className="shrink-0 text-muted" />
      <label className="sr-only" htmlFor={`add-${status ?? "x"}-${due ?? ""}-${listId ?? ""}`}>
        New task title
      </label>
      <input
        id={`add-${status ?? "x"}-${due ?? ""}-${listId ?? ""}`}
        name="title"
        required
        maxLength={200}
        placeholder={compact ? "Add task" : "Add a task and press Enter"}
        className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm placeholder:text-muted hover:border-line focus:border-brand/60 focus:bg-bg focus:outline-none"
      />
    </form>
  );
}

function StatusPicker({ task, statuses, back }: { task: HqTask; statuses: SpaceStatus[]; back: string }) {
  return (
    <form action={moveTaskFormAction} className="contents">
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="back" value={back} />
      <AutoSelect label={`Status of ${task.title}`} name="status" defaultValue={task.status} className="input input-xs w-36">
        {statuses.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </AutoSelect>
      <noscript>
        <button className="btn btn-ghost btn-sm">Save</button>
      </noscript>
    </form>
  );
}

function Assignee({ name }: { name: string | null }) {
  if (!name) return <span className="text-xs text-faint">Nobody</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand/40 bg-raised text-[10px] font-semibold text-accent">
        {name
          .split(/\s+/)
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
          .toUpperCase()}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

// ---------------- List ----------------

function groupsFor(group: Group, tasks: HqTask[], statuses: SpaceStatus[], lists: ListLite[]) {
  if (group === "status") return statuses.map((s) => ({ key: s.key, label: s.label, color: s.color, ring: s.group === "todo", status: s.key, listId: undefined as number | undefined, rows: tasks.filter((t) => t.status === s.key) }));
  if (group === "priority")
    return PRIORITIES.map(([k, label]) => ({ key: k, label, color: { urgent: "danger", high: "warn", normal: "info", low: "slate" }[k], ring: false, status: undefined, listId: undefined, rows: tasks.filter((t) => t.priority === k) }));
  if (group === "list") return lists.map((l) => ({ key: String(l.id), label: l.name, color: "brand", ring: false, status: undefined, listId: l.id, rows: tasks.filter((t) => t.listId === l.id) }));
  const names = [...new Set(tasks.map((t) => t.assignee ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return names.map((n) => ({ key: n || "none", label: n || "Nobody yet", color: "slate", ring: !n, status: undefined, listId: undefined, rows: tasks.filter((t) => (t.assignee ?? "") === n) }));
}

export function ListView({ tasks, statuses, lists, group, back, canWrite, showList, listId }: {
  tasks: HqTask[];
  statuses: SpaceStatus[];
  lists: ListLite[];
  group: Group;
  back: string;
  canWrite: boolean;
  showList: boolean;
  listId?: number;
}) {
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  const groups = groupsFor(group, tasks, statuses, lists);
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        if (!g.rows.length && group !== "status") return null;
        return (
          <section key={g.key} aria-label={`${g.label}, ${g.rows.length} tasks`} className="card overflow-hidden">
            <header className="flex items-center gap-2.5 border-b border-line bg-raised/40 px-4 py-2.5">
              <Dot color={g.color} size={10} ring={g.ring} />
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em]">{g.label}</h3>
              <span className="count">{g.rows.length}</span>
            </header>
            {g.rows.length > 0 && (
              <ul className="divide-y divide-line/70">
                {g.rows.map((t) => (
                  <li key={t.id} className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 transition-colors hover:bg-raised/50 md:flex-nowrap">
                    <div className="flex min-w-0 flex-1 basis-64 items-center gap-2.5">
                      <Dot color={byKey.get(t.status)?.color ?? "slate"} ring={byKey.get(t.status)?.group === "todo"} />
                      <Link href={`/tasks/${t.id}`} className={`min-w-0 truncate text-sm font-medium hover:text-accent ${t.doneAt ? "text-muted line-through" : ""}`}>
                        {t.title}
                      </Link>
                      {t.subtasks > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-[11px] text-muted" title="Subtasks done">
                          <Icon name="list" size={11} />
                          {t.subtasksDone}/{t.subtasks}
                        </span>
                      )}
                      {t.tags.map((tag) => (
                        <span key={tag} className="hidden shrink-0 rounded bg-raised px-1.5 py-0.5 text-[11px] text-muted lg:inline">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    {showList && <span className="hidden w-32 shrink-0 truncate text-xs text-muted xl:block">{t.listName}</span>}
                    <span className="w-36 shrink-0">
                      <Assignee name={t.assignee} />
                    </span>
                    <span className="w-28 shrink-0">
                      <DueDate due={t.dueAt} overdue={t.overdue} done={!!t.doneAt} />
                    </span>
                    <span className="w-20 shrink-0">
                      <PriorityFlag priority={t.priority} />
                    </span>
                    <span className="shrink-0">
                      {canWrite ? <StatusPicker task={t} statuses={statuses} back={back} /> : <StatusPill status={byKey.get(t.status)} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (g.status || g.listId || group === "status") && (
              <div className="border-t border-line/70 px-3 py-1.5">
                <QuickAddRow back={back} lists={lists} listId={g.listId ?? listId} status={g.status} />
              </div>
            )}
          </section>
        );
      })}
      {group !== "status" && !tasks.length && <p className="text-sm text-muted">No tasks match.</p>}
    </div>
  );
}

// ---------------- Table ----------------

export function TableView({ tasks, statuses, people, back, canWrite }: { tasks: HqTask[]; statuses: SpaceStatus[]; people: Person[]; back: string; canWrite: boolean }) {
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto" role="region" aria-label="Tasks table" tabIndex={0}>
        <table className="table min-w-[1000px]">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Status</th>
              <th scope="col">List</th>
              <th scope="col">Assignee</th>
              <th scope="col">Priority</th>
              <th scope="col">Start</th>
              <th scope="col">Due</th>
              <th scope="col">Tags</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <th scope="row" className="max-w-[320px] font-normal">
                  <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:text-accent">
                    {t.title}
                  </Link>
                  {t.subtasks > 0 && <span className="text-[11px] text-muted">{t.subtasksDone}/{t.subtasks} subtasks</span>}
                </th>
                <td>{canWrite ? <StatusPicker task={t} statuses={statuses} back={back} /> : <StatusPill status={byKey.get(t.status)} />}</td>
                <td className="text-xs text-muted">{t.listName}</td>
                <td>
                  {canWrite ? (
                    <form action={patchTaskAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="field" value="assignee" />
                      <input type="hidden" name="back" value={back} />
                      <AutoSelect label={`Assignee of ${t.title}`} name="value" defaultValue={t.assigneeId ?? ""} className="input input-xs w-36">
                        <option value="">Nobody</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </AutoSelect>
                    </form>
                  ) : (
                    <Assignee name={t.assignee} />
                  )}
                </td>
                <td>
                  {canWrite ? (
                    <form action={patchTaskAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="field" value="priority" />
                      <input type="hidden" name="back" value={back} />
                      <AutoSelect label={`Priority of ${t.title}`} name="value" defaultValue={t.priority} className="input input-xs w-28">
                        {PRIORITIES.map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </AutoSelect>
                    </form>
                  ) : (
                    <PriorityFlag priority={t.priority} showNormal />
                  )}
                </td>
                <td className="whitespace-nowrap text-xs text-muted">{t.startAt ? formatCairo(t.startAt, false) : "—"}</td>
                <td>
                  <DueDate due={t.dueAt} overdue={t.overdue} done={!!t.doneAt} />
                </td>
                <td className="text-xs text-muted">{t.tags.map((x) => `#${x}`).join(" ") || "—"}</td>
              </tr>
            ))}
            {!tasks.length && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-muted">
                  No tasks match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Calendar ----------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A month on the Cairo calendar, weeks starting Monday, tasks on their due day. */
export function CalendarView({ tasks, statuses, month, lists, listId, back, canWrite, addDay, hrefFor, now = new Date() }: {
  tasks: HqTask[];
  statuses: SpaceStatus[];
  month: string; // YYYY-MM
  lists: ListLite[];
  listId?: number;
  back: string;
  canWrite: boolean;
  addDay?: string;
  hrefFor: (q: { month?: string; add?: string }) => string;
  now?: Date;
}) {
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDaysYmd(first, -lead);
  const days = Array.from({ length: 42 }, (_, i) => addDaysYmd(start, i));
  const weeks = days.slice(35).every((d) => !d.startsWith(month)) ? days.slice(0, 35) : days;
  const today = cairoYmd(now);
  const byDay = new Map<string, HqTask[]>();
  for (const t of tasks) if (t.dueAt) byDay.set(cairoYmd(t.dueAt), [...(byDay.get(cairoYmd(t.dueAt)) ?? []), t]);
  const unscheduled = tasks.filter((t) => !t.dueAt);
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="mr-auto text-base font-semibold">{title}</h3>
          <Link href={hrefFor({ month: shift(-1) })} className="btn btn-ghost btn-sm btn-icon" aria-label="Previous month">
            <Icon name="chevronLeft" />
          </Link>
          <Link href={hrefFor({ month: today.slice(0, 7) })} className="btn btn-secondary btn-sm">
            Today
          </Link>
          <Link href={hrefFor({ month: shift(1) })} className="btn btn-ghost btn-sm btn-icon" aria-label="Next month">
            <Icon name="chevronRight" />
          </Link>
        </div>
        {canWrite && addDay && (
          <div className="border-b border-line bg-brand/5 px-4 py-2">
            <p className="mb-1 text-xs text-muted">New task due {formatCairo(new Date(`${addDay}T10:00:00Z`), false)}</p>
            <QuickAddRow back={back} lists={lists} listId={listId} due={addDay} />
          </div>
        )}
        <div className="overflow-x-auto" role="region" aria-label="Calendar" tabIndex={0}>
          <div className="grid min-w-[720px] grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div key={d} className="border-b border-line px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted">
                {d}
              </div>
            ))}
            {weeks.map((d) => {
              const inMonth = d.startsWith(month);
              const items = byDay.get(d) ?? [];
              return (
                <div key={d} className={`group relative min-h-[112px] border-b border-r border-line/70 p-1.5 ${inMonth ? "" : "bg-bg/40"}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums ${
                        d === today ? "bg-brand font-semibold text-onbrand" : inMonth ? "text-fg" : "text-muted"
                      }`}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {canWrite && (
                      <Link href={hrefFor({ month, add: d })} className="rounded p-0.5 text-muted opacity-0 transition hover:bg-raised hover:text-fg focus:opacity-100 group-hover:opacity-100" aria-label={`Add a task due ${d}`}>
                        <Icon name="plus" size={13} />
                      </Link>
                    )}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {items.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/tasks/${t.id}`}
                          className={`flex items-center gap-1.5 truncate rounded-md border border-line bg-surface px-1.5 py-1 text-[12px] leading-tight hover:border-brand/50 ${t.doneAt ? "text-muted line-through" : ""}`}
                          title={t.title}
                        >
                          <Dot color={byKey.get(t.status)?.color ?? "slate"} size={6} />
                          <span className="truncate">{t.title}</span>
                        </Link>
                      </li>
                    ))}
                    {items.length > 4 && <li className="px-1 text-[11px] text-muted">+{items.length - 4} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <aside className="card h-fit">
        <div className="card-head">
          <h3 className="card-title">No date yet</h3>
          <span className="count">{unscheduled.length}</span>
        </div>
        <ul className="divide-y divide-line/70">
          {unscheduled.slice(0, 30).map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-4 py-2.5">
              <Dot color={byKey.get(t.status)?.color ?? "slate"} />
              <Link href={`/tasks/${t.id}`} className="min-w-0 truncate text-sm hover:text-accent">
                {t.title}
              </Link>
            </li>
          ))}
          {!unscheduled.length && <li className="px-4 py-4 text-sm text-muted">Every task has a date.</li>}
        </ul>
      </aside>
    </div>
  );
}
