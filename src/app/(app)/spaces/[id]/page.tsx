import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { HqBoard } from "@/components/hq/HqBoard";
import { SpaceBadge, ViewTabs, type ViewKey } from "@/components/hq/bits";
import { CalendarView, ListView, QuickAddRow, TableView, type Group } from "@/components/hq/views";
import { Icon } from "@/components/ui";
import { getSpace, listDocs, listSpaces, spaceTasks } from "@/lib/hq";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd, formatCairo } from "@/lib/time";
import { saveListAction } from "../../hq/actions";

export const metadata = { title: "Space" };

type Search = { view?: string; list?: string; me?: string; q?: string; closed?: string; group?: string; month?: string; add?: string; notice?: string; error?: string };

const GROUPS: { key: Group; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "priority", label: "Priority" },
  { key: "list", label: "List" },
];

export default async function SpacePage(props: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("hq:read");
  if (!/^\d+$/.test(id)) notFound();
  const space = await getSpace(db, Number(id));
  if (!space) notFound();

  const view: ViewKey = (["list", "board", "calendar", "table"] as const).find((v) => v === sp.view) ?? "list";
  const group: Group = GROUPS.find((g) => g.key === sp.group)?.key ?? "status";
  const me = sp.me === "1";
  // the board always shows its Done columns (recently finished work), so a card can be dragged there
  const closed = sp.closed === "1" || view === "calendar" || view === "board";
  const q = (sp.q ?? "").slice(0, 100);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : cairoYmd(new Date()).slice(0, 7);
  const addDay = /^\d{4}-\d{2}-\d{2}$/.test(sp.add ?? "") ? sp.add : undefined;

  const [tree, people, docs] = await Promise.all([
    listSpaces(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    listDocs(db, { spaceId: space.id, limit: 6 }),
  ]);
  const node = tree.find((s) => s.id === space.id)!;
  const lists = node.lists;
  const list = lists.find((l) => String(l.id) === sp.list);
  const fortnight = new Date(Date.now() - 14 * 86_400_000);
  const tasks = (await spaceTasks(db, space, { listId: list?.id, assigneeId: me ? user.id : undefined, q, closed })).filter(
    (t) => view !== "board" || sp.closed === "1" || !t.doneAt || t.doneAt >= fortnight,
  );

  const canWrite = can(user.role, "task:write");
  const canManage = can(user.role, "ops:manage");
  // every link keeps the other choices of the view
  const href = (o: Partial<Record<"view" | "list" | "me" | "q" | "closed" | "group" | "month" | "add", string | undefined>>) => {
    const p = new URLSearchParams();
    const v = { view, list: list ? String(list.id) : undefined, me: me ? "1" : undefined, q: q || undefined, closed: sp.closed === "1" ? "1" : undefined, group: group === "status" ? undefined : group, month: view === "calendar" ? month : undefined, ...o };
    for (const [k, val] of Object.entries(v)) if (val && !(k === "view" && val === "list")) p.set(k, val);
    const s = p.toString();
    return `/spaces/${space.id}${s ? `?${s}` : ""}`;
  };
  const back = href({ add: undefined });
  const open = tasks.filter((t) => !t.doneAt);
  const overdue = open.filter((t) => t.overdue).length;
  const doneGroup = space.statuses.filter((s) => s.group === "done").map((s) => s.key);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/hq" className="hover:text-fg">
          HQ
        </Link>
        <Icon name="chevronRight" size={14} className="text-faint" />
        <Link href={`/spaces/${space.id}`} className={list ? "hover:text-fg" : "font-medium text-fg"}>
          {space.name}
        </Link>
        {list && (
          <>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <span className="font-medium text-fg">{list.name}</span>
          </>
        )}
      </nav>

      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <SpaceBadge color={space.color} icon={space.icon} size={48} />
          <div className="min-w-0">
            <h1 className="page-title">{list?.name ?? space.name}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted">{(list ? list.description : space.description) || `${open.length} open tasks${overdue ? `, ${overdue} overdue` : ""}`}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/docs/new?space=${space.id}`} className="btn btn-secondary btn-sm">
            <Icon name="note" size={14} /> New doc
          </Link>
          {canManage && (
            <Link href={`/spaces/${space.id}/settings`} className="btn btn-ghost btn-sm">
              <Icon name="settings" size={14} /> Space settings
            </Link>
          )}
        </div>
      </header>
      <Flash notice={sp.notice} error={sp.error} />

      {/* the lists of this space, as chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={href({ list: undefined })} aria-current={!list ? "page" : undefined} className={`chip ${!list ? "chip-brand" : "hover:text-fg"}`}>
          All lists <span className="tabular-nums">{node.open}</span>
        </Link>
        {lists.map((l) => (
          <Link key={l.id} href={href({ list: String(l.id) })} aria-current={list?.id === l.id ? "page" : undefined} className={`chip ${list?.id === l.id ? "chip-brand" : "hover:text-fg"}`}>
            {l.name} <span className="tabular-nums">{l.open}</span>
          </Link>
        ))}
        {canWrite && (
          <details className="relative">
            <summary className="chip cursor-pointer list-none border-dashed hover:text-fg">
              <Icon name="plus" size={12} /> New list
            </summary>
            <form action={saveListAction} className="absolute left-0 top-full z-20 mt-2 flex w-72 flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-pop">
              <input type="hidden" name="spaceId" value={space.id} />
              <input type="hidden" name="back" value={back} />
              <label className="field">
                List name
                <input name="name" required maxLength={80} className="input input-sm" placeholder="e.g. October batch prep" />
              </label>
              <button className="btn btn-primary btn-sm self-end">Add list</button>
            </form>
          </details>
        )}
      </div>

      {/* view bar and controls */}
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-line bg-surface/60 p-2 lg:flex-row lg:items-center">
        <ViewTabs current={view} href={(v) => href({ view: v, add: undefined })} />
        <form action={`/spaces/${space.id}`} className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {view !== "list" && <input type="hidden" name="view" value={view} />}
          {list && <input type="hidden" name="list" value={list.id} />}
          {view === "calendar" && <input type="hidden" name="month" value={month} />}
          <label className="sr-only" htmlFor="space-q">
            Search tasks
          </label>
          <div className="relative">
            <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input id="space-q" name="q" defaultValue={q} placeholder="Search or #tag" className="input input-xs w-44 pl-8" />
          </div>
          {view === "list" && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Group
              <select name="group" defaultValue={group} className="input input-xs w-28">
                {GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" name="me" value="1" defaultChecked={me} className="check" /> Only mine
          </label>
          {view !== "calendar" && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" name="closed" value="1" defaultChecked={sp.closed === "1"} className="check" /> {view === "board" ? "All done" : "Show done"}
            </label>
          )}
          <button className="btn btn-secondary btn-sm">Apply</button>
        </form>
      </div>

      {!lists.length ? (
        <div className="card p-10 text-center">
          <Icon name="list" size={28} className="mx-auto text-accent" />
          <h2 className="mt-3 text-lg font-semibold">Add the first list</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">A list holds the tasks of one project or stream of work in {space.name}. Use “New list” above.</p>
        </div>
      ) : view === "board" ? (
        <HqBoard
          statuses={space.statuses}
          canWrite={canWrite}
          showList={!list}
          cards={tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            listName: t.listName,
            assignee: t.assignee,
            due: t.dueAt ? formatCairo(t.dueAt, false) : null,
            overdue: t.overdue,
            subtasks: t.subtasks,
            subtasksDone: t.subtasksDone,
            tags: t.tags,
            position: t.position,
          }))}
          addForms={Object.fromEntries(space.statuses.map((s) => [s.key, <QuickAddRow key={s.key} back={back} lists={lists} listId={list?.id} status={s.key} compact />]))}
        />
      ) : view === "table" ? (
        <TableView tasks={tasks} statuses={space.statuses} people={people} back={back} canWrite={canWrite} />
      ) : view === "calendar" ? (
        <CalendarView tasks={tasks} statuses={space.statuses} month={month} lists={lists} listId={list?.id} back={back} canWrite={canWrite} addDay={addDay} hrefFor={(o) => href(o)} />
      ) : (
        <ListView tasks={tasks} statuses={space.statuses.filter((s) => sp.closed === "1" || !doneGroup.includes(s.key))} lists={lists} group={group} back={back} canWrite={canWrite} showList={!list} listId={list?.id} />
      )}

      {docs.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-3">Docs in {space.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {docs.map((d) => (
              <Link key={d.id} href={`/docs/${d.id}`} className="card flex items-center gap-3 p-4 transition hover:border-brand/50">
                <Icon name="note" className="text-accent" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{d.title}</span>
                  <span className="block text-xs text-muted">
                    {d.wiki ? "Wiki · " : ""}updated {formatCairo(d.updatedAt, false)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
