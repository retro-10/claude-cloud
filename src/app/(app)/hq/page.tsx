import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { DueDate, PriorityFlag, SpaceBadge } from "@/components/hq/bits";
import { Card, EmptyState, Icon, Stat } from "@/components/ui";
import { WORK_BUCKETS, bucketOf, listDocs, listSpaces, type WorkBucket } from "@/lib/hq";
import { inbox } from "@/lib/notifications";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { listTasks, type TaskRow } from "@/lib/tasks";
import { formatCairo, TZ } from "@/lib/time";
import { quickTaskAction, starterSpacesAction } from "./actions";

export const metadata = { title: "HQ" };

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function where(t: TaskRow) {
  if (t.listName) return t.listName;
  if (t.leadName) return t.leadName;
  if (t.cohortName) return t.cohortName;
  return "Tasks";
}

// HQ home: my work across the company, the spaces, the newest docs and what landed in my inbox.
export default async function HqHome(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const now = new Date();
  const [mine, done, spaces, docs, unread] = await Promise.all([
    listTasks(db, { assigneeId: user.id, status: "open" }, now, 300),
    listTasks(db, { assigneeId: user.id, status: "done" }, now, 50),
    listSpaces(db),
    listDocs(db, { limit: 6 }),
    inbox(db, user.id, "new", 5),
  ]);
  const buckets = new Map<WorkBucket, TaskRow[]>(WORK_BUCKETS.map((b) => [b.key, []]));
  for (const t of mine) buckets.get(bucketOf(t.dueAt, now))!.push(t);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const doneThisWeek = done.filter((t) => t.doneAt && t.doneAt >= weekAgo).length;
  const canWrite = can(user.role, "task:write");
  const lists = spaces.flatMap((s) => s.lists.map((l) => ({ id: l.id, name: `${s.name} / ${l.name}` })));
  const first = user.name.split(/\s+/)[0];

  return (
    <>
      <header className="mb-8 flex flex-col gap-1 animate-rise-in">
        <div className="eyebrow">{formatCairo(now, false)}</div>
        <h1 className="page-title">
          {greeting(now)}, {first}
        </h1>
        <p className="text-sm text-muted">Your work across OrlaDent, the areas of the company, and what is new.</p>
      </header>
      <Flash notice={sp.notice} error={sp.error} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="My open tasks" value={mine.length} icon="check" tone="brand" />
        <Stat label="Overdue" value={buckets.get("overdue")!.length} icon="alert" />
        <Stat label="Due today" value={buckets.get("today")!.length} icon="today" />
        <Stat label="Done in the last 7 days" value={doneThisWeek} icon="trend" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          {canWrite && lists.length > 0 && (
            <form action={quickTaskAction} className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center" aria-label="Quick add a task">
              <input type="hidden" name="back" value="/hq" />
              <Icon name="plus" className="ml-1 hidden text-accent sm:block" />
              <label className="sr-only" htmlFor="hq-title">
                Task
              </label>
              <input id="hq-title" name="title" required maxLength={200} placeholder="What needs doing?" className="input input-sm min-w-0 flex-1 border-transparent bg-transparent shadow-none" />
              <label className="sr-only" htmlFor="hq-list">
                List
              </label>
              <select id="hq-list" name="listId" className="input input-sm sm:w-56" defaultValue={lists[0].id}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="hq-due">
                Due
              </label>
              <input id="hq-due" type="date" name="due" className="input input-sm sm:w-40" />
              <button className="btn btn-primary btn-sm">Add</button>
            </form>
          )}

          <Card title="My work" icon="list" actions={<Link href="/tasks" className="btn btn-ghost btn-sm">All tasks</Link>} bodyClass="p-0">
            {!mine.length ? (
              <div className="p-5">
                <EmptyState icon="check" title="Nothing on your plate">
                  Tasks assigned to you, from any space, lead or batch, show up here by due date.
                </EmptyState>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {WORK_BUCKETS.map((b) => {
                  const rows = buckets.get(b.key)!;
                  if (!rows.length) return null;
                  const firstShown = WORK_BUCKETS.find((x) => buckets.get(x.key)!.length)?.key === b.key;
                  return (
                    <details key={b.key} open={firstShown || (b.key !== "later" && b.key !== "unscheduled")} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 hover:bg-raised/40">
                        <Icon name="chevronRight" size={14} className="text-muted transition group-open:rotate-90" />
                        <span className={`text-xs font-semibold uppercase tracking-[0.1em] ${b.key === "overdue" ? "text-danger" : ""}`}>{b.label}</span>
                        <span className="count">{rows.length}</span>
                      </summary>
                      <ul className="pb-2">
                        {rows.slice(0, 40).map((t) => (
                          <li key={t.id} className="flex items-center gap-3 px-5 py-2 hover:bg-raised/40">
                            <span aria-hidden className={`h-4 w-4 shrink-0 rounded-full border-2 ${t.overdue ? "border-danger" : "border-faint"}`} />
                            <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent">
                              {t.title}
                            </Link>
                            <span className="hidden max-w-[200px] truncate text-xs text-muted md:block">{where(t)}</span>
                            <PriorityFlag priority={t.priority} />
                            <span className="w-28 shrink-0 text-right">
                              <DueDate due={t.dueAt} overdue={t.overdue} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}
              </div>
            )}
          </Card>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="eyebrow">Spaces</h2>
              {can(user.role, "ops:manage") && spaces.length > 0 && (
                <Link href="/spaces/new" className="btn btn-ghost btn-sm">
                  <Icon name="plus" size={14} /> New space
                </Link>
              )}
            </div>
            {!spaces.length ? (
              <div className="card p-8 text-center">
                <Icon name="layers" size={28} className="mx-auto text-accent" />
                <h3 className="mt-3 text-lg font-semibold">Set up HQ</h3>
                <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
                  Spaces are the areas of the company. Each holds lists of tasks, a board, a calendar and docs. Start with Sales, Academy, Studio, Marketing and Operations, or make your own.
                </p>
                {can(user.role, "ops:manage") ? (
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <form action={starterSpacesAction}>
                      <input type="hidden" name="back" value="/hq" />
                      <button className="btn btn-primary">Create the five spaces</button>
                    </form>
                    <Link href="/spaces/new" className="btn btn-secondary">
                      Make my own
                    </Link>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted">An owner sets the spaces up.</p>
                )}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {spaces.map((s) => (
                  <Link key={s.id} href={`/spaces/${s.id}`} className="card group flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-lift">
                    <div className="flex items-center gap-3">
                      <SpaceBadge color={s.color} icon={s.icon} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{s.name}</div>
                        <div className="text-xs text-muted">
                          {s.lists.length} {s.lists.length === 1 ? "list" : "lists"} · {s.open} open
                        </div>
                      </div>
                      <Icon name="arrowRight" size={16} className="ml-auto text-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
                    </div>
                    {s.description && <p className="line-clamp-2 text-xs text-muted">{s.description}</p>}
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Inbox" icon="inbox" actions={<Link href="/inbox" className="btn btn-ghost btn-sm">Open</Link>} bodyClass="p-0">
            {!unread.length ? (
              <p className="px-5 py-4 text-sm text-muted">You are all caught up.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {unread.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    {n.leadId ? (
                      <Link href={`/leads/${n.leadId}`} className="text-sm hover:text-accent">
                        {n.title}
                      </Link>
                    ) : (
                      <span className="text-sm">{n.title}</span>
                    )}
                    <div className="text-xs text-muted">{formatCairo(n.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Docs" icon="note" actions={<Link href="/docs" className="btn btn-ghost btn-sm">All docs</Link>} bodyClass="p-0">
            {!docs.length ? (
              <div className="px-5 py-4 text-sm text-muted">
                No docs yet.{" "}
                {canWrite && (
                  <Link href="/docs/new" className="text-accent underline underline-offset-2">
                    Write the first one
                  </Link>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-line/70">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/docs/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-raised/40">
                      <Icon name="note" size={16} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title}</span>
                        <span className="block text-xs text-muted">
                          {d.spaceName ?? "Company"} · {formatCairo(d.updatedAt, false)}
                        </span>
                      </span>
                      {d.wiki && <span className="chip chip-brand">Wiki</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
