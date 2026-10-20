import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { TaskForm, TaskList } from "@/components/tasks/TaskPanel";
import { Card, PageHeader, Stat, Tabs } from "@/components/ui";
import { listCohorts } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { listTasks, taskCounts, type TaskFilter } from "@/lib/tasks";

export const metadata = { title: "Tasks" };

type Search = { who?: string; due?: string; notice?: string; error?: string };

const DUE = [
  ["", "Any date"],
  ["overdue", "Overdue"],
  ["today", "Due by today"],
  ["week", "Due this week"],
  ["none", "No date"],
] as const;

// The team's to-do list: tasks on leads, students and batches, or on nothing in particular.
export default async function TasksPage(props: { searchParams: Promise<Search> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const who = sp.who ?? "mine";
  const due = DUE.some(([k]) => k === sp.due) ? (sp.due as TaskFilter["due"] | "") : "";
  const filter: TaskFilter = {
    status: who === "done" ? "done" : "open",
    assigneeId: who === "mine" ? user.id : who === "none" ? "none" : /^\d+$/.test(who) ? Number(who) : undefined,
    due: due || undefined,
  };
  const [rows, counts, people, batches] = await Promise.all([
    listTasks(db, filter),
    taskCounts(db, user.id),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    listCohorts(db),
  ]);
  const canWrite = can(user.role, "task:write");
  const qs = (w: string) => `/tasks?who=${w}${due ? `&due=${due}` : ""}`;
  const back = `/tasks?who=${who}${due ? `&due=${due}` : ""}`;

  return (
    <>
      <PageHeader eyebrow="Work" title="Tasks" subtitle="Everything the team has to do, on a lead, a student, a batch, or on its own. Follow-ups with leads stay on Today." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="My open tasks" value={counts.mine} icon="check" tone="brand" />
        <Stat label="Mine overdue" value={counts.mineOverdue} icon="alert" />
        <Stat label="Overdue, whole team" value={counts.overdue} icon="hourglass" />
        <Stat label="Unassigned" value={counts.unassigned} icon="user" />
      </div>
      <Tabs
        current={qs(["mine", "all", "none", "done"].includes(who) ? who : "all")}
        items={[
          { href: qs("mine"), label: "Mine", count: counts.mine },
          { href: qs("all"), label: "Everyone" },
          { href: qs("none"), label: "Unassigned", count: counts.unassigned },
          { href: qs("done"), label: "Done" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title={who === "done" ? "Recently done" : "Open tasks"}
          icon="list"
          actions={
            <form action="/tasks" className="flex items-center gap-2" aria-label="Filter tasks">
              <input type="hidden" name="who" value={who} />
              <label className="sr-only" htmlFor="due-filter">
                Due
              </label>
              <select id="due-filter" name="due" defaultValue={due} className="input input-sm">
                {DUE.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="btn btn-ghost btn-sm">Show</button>
            </form>
          }
        >
          <TaskList rows={rows} back={back} canWrite={canWrite} empty={who === "done" ? "Nothing finished yet." : "No open tasks. Nice."} />
        </Card>
        {canWrite && (
          <Card title="New task" icon="plus">
            <TaskForm people={people} back={back} batches={batches} me={user.id} open />
          </Card>
        )}
      </div>
    </>
  );
}
