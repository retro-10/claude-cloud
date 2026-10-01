import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { ClassForm } from "@/components/programme/ClassForm";
import { Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { listClasses, type ClassRow } from "@/lib/classes";
import { listCohorts } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { cairoYmd, formatCairo } from "@/lib/time";
import { copyScheduleAction } from "./actions";

export const metadata = { title: "Classes" };

function ClassList({ rows, empty }: { rows: ClassRow[]; empty: string }) {
  if (!rows.length) return <EmptyState icon="calendar" title={empty} />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="w-28 shrink-0 text-xs text-muted">{formatCairo(c.startsAt)}</div>
          <div className="min-w-0 flex-1">
            <Link href={`/classes/${c.id}`} className="link font-medium" dir="auto">
              {c.title}
            </Link>
            <div className="text-xs text-muted" dir="auto">
              {[c.cohort, c.module, c.instructor].filter(Boolean).join(" · ")}
            </div>
          </div>
          {c.marked > 0 ? <span className="chip">{c.came} of {c.marked} came</span> : c.startsAt < new Date() ? <span className="chip chip-warn">attendance not taken</span> : null}
        </li>
      ))}
    </ul>
  );
}

// Every batch's class schedule. Instructors see theirs with "Mine".
export default async function ClassesPage(props: { searchParams: Promise<{ batch?: string; mine?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const write = can(user.role, "programme:write");
  const batch = Number(sp.batch) || undefined;
  const mine = sp.mine === "1";
  const [rows, batches, people] = await Promise.all([
    listClasses(db, { cohortId: batch, instructorId: mine ? user.id : undefined }),
    listCohorts(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  const today = cairoYmd(new Date());
  const upcoming = rows.filter((c) => cairoYmd(c.startsAt) >= today);
  const past = rows.filter((c) => cairoYmd(c.startsAt) < today).reverse();
  const allHref = `/classes${batch ? `?batch=${batch}` : ""}`;
  const mineHref = `/classes?mine=1${batch ? `&batch=${batch}` : ""}`;
  const qs = (o: Record<string, string | undefined>) => `/classes?${new URLSearchParams(Object.entries({ batch: batch ? String(batch) : undefined, mine: mine ? "1" : undefined, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader eyebrow="Programme" title="Classes" subtitle="Each batch's group classes: when, who teaches, the room or link, materials and recordings, and who came." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs current={mine ? mineHref : allHref} items={[{ href: allHref, label: "All classes" }, { href: mineHref, label: "Mine" }]} />
        <form action="/classes" className="ml-auto flex items-end gap-2" aria-label="Filter by batch">
          {mine && <input type="hidden" name="mine" value="1" />}
          <label className="field">
            Batch
            <select name="batch" defaultValue={batch ?? ""} className="input input-sm">
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost btn-sm">Show</button>
        </form>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Card title={`Coming up (${upcoming.length})`} icon="calendar" bodyClass="p-0">
            <ClassList rows={upcoming} empty="No classes scheduled." />
          </Card>
          <Card title={`Held (${past.length})`} icon="history" bodyClass="p-0">
            <ClassList rows={past} empty="None yet." />
          </Card>
        </div>
        {write && (
          <div className="flex flex-col gap-5">
            <Card title="Add a class" icon="plus">
              <ClassForm batches={batches} people={people} back={qs({})} cohortId={batch} />
            </Card>
            <Card title="Copy a schedule" icon="copy">
              <form action={copyScheduleAction} className="grid gap-3">
                <label className="field">
                  From batch
                  <select name="fromCohortId" required className="input input-sm">
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  To batch
                  <select name="toCohortId" required defaultValue={batch ?? ""} className="input input-sm">
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  First class on
                  <input name="firstDay" type="date" required className="input input-sm" />
                </label>
                <button className="btn btn-secondary btn-sm self-start">Copy the schedule</button>
                <p className="text-xs text-muted">Same classes, order, gaps and times of day; recordings are not copied.</p>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
