import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { AssignmentForm } from "@/components/programme/AssignmentForm";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { listAssignments } from "@/lib/assignments";
import { listCohorts } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Assignments" };

// Cases students design, reviewed against a rubric. Reviews feed each student's QC score and the leaderboard.
export default async function AssignmentsPage(props: { searchParams: Promise<{ batch?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const batch = Number(sp.batch) || undefined;
  const [rows, batches] = await Promise.all([listAssignments(db, { cohortId: batch }), listCohorts(db)]);
  const waiting = rows.reduce((a, r) => a + r.waiting, 0);
  return (
    <>
      <PageHeader eyebrow="Programme" title="Assignments" subtitle="Cases students design, scored against a rubric. A review sets the student's QC score (the average of their reviewed work) and the batch leaderboard." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for review" value={waiting} icon="hourglass" tone="brand" />
        <Stat label="Assignments" value={rows.length} icon="list" />
        <Stat label="Passed" value={rows.reduce((a, r) => a + r.passed, 0)} icon="check" />
        <Stat label="Need rework" value={rows.reduce((a, r) => a + r.rework, 0)} icon="history" />
      </div>
      <form action="/assignments" className="mb-4 flex items-end gap-2" aria-label="Filter by batch">
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
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title="Assignments" icon="list" bodyClass="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState icon="list" title="No assignments yet." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Assignment</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="text-right">To review</th>
                  <th scope="col" className="text-right">Passed</th>
                  <th scope="col" className="text-right">Rework</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/assignments/${a.id}`} className="link font-medium" dir="auto">
                        {a.title}
                      </Link>
                      <div className="text-xs text-muted">{a.cohort}</div>
                    </td>
                    <td className="whitespace-nowrap text-xs">{a.dueAt ? formatCairo(a.dueAt) : "—"}</td>
                    <td className="num text-right">{a.waiting ? <span className="chip chip-warn">{a.waiting}</span> : 0}</td>
                    <td className="num text-right">
                      {a.passed} / {a.students}
                    </td>
                    <td className="num text-right">{a.rework}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {can(user.role, "programme:write") && (
          <Card title="Add an assignment" icon="plus">
            <AssignmentForm batches={batches} cohortId={batch} />
          </Card>
        )}
      </div>
    </>
  );
}
