import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { listCohorts } from "@/lib/cohorts";
import { getSop, listRuns } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { deleteSopAction, saveSopAction, startRunAction } from "../../actions";

export const metadata = { title: "Playbook · Team" };

export default async function SopPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const s = await getSop(db, Number(id));
  if (!s) notFound();
  const manage = can(user.role, "ops:manage");
  const run = can(user.role, "task:write");
  const [runs, batches, people] = await Promise.all([
    listRuns(db, { sopId: s.id }),
    listCohorts(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);

  return (
    <>
      <Link href="/team/sops" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Playbooks
      </Link>
      <PageHeader eyebrow={s.area ?? "Playbook"} title={s.title} titleDir="auto" subtitle={s.purpose} />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Card title={`Steps (${s.steps.length})`} icon="list">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {s.steps.map((step, i) => (
                <li key={i} dir="auto">
                  {step}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Used" icon="history" bodyClass="p-0">
            {!runs.length ? (
              <p className="p-4 text-sm text-muted">Not started yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <Link href={`/team/runs/${r.id}`} className="link min-w-0 flex-1" dir="auto">
                      {r.title}
                    </Link>
                    <span className="text-xs text-muted">{r.completedAt ? `done ${formatCairo(r.completedAt, false)}` : `${r.doneSteps} of ${r.steps.length}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          {run && (
            <Card title="Start as a checklist" icon="flag">
              <form action={startRunAction} className="grid gap-3">
                <input type="hidden" name="sopId" value={s.id} />
                <label className="field">
                  For a batch (optional)
                  <select name="cohortId" defaultValue="" className="input input-sm">
                    <option value="">—</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Who runs it
                  <select name="assigneeId" defaultValue={user.id} className="input input-sm">
                    <option value="">Not set</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Done by (optional)
                  <input name="due" type="date" className="input input-sm" />
                </label>
                <button className="btn btn-primary btn-sm justify-self-start">Start the checklist</button>
              </form>
            </Card>
          )}
          {manage && (
            <Card title="Edit" icon="edit">
              <form action={saveSopAction} className="grid gap-3">
                <input type="hidden" name="id" value={s.id} />
                <label className="field">
                  Title
                  <input name="title" required maxLength={200} defaultValue={s.title} dir="auto" className="input input-sm" />
                </label>
                <label className="field">
                  Area
                  <input name="area" maxLength={60} defaultValue={s.area ?? ""} className="input input-sm" />
                </label>
                <label className="field">
                  When and why
                  <input name="purpose" maxLength={2000} defaultValue={s.purpose ?? ""} dir="auto" className="input input-sm" />
                </label>
                <label className="field">
                  Steps, one per line
                  <textarea name="steps" required rows={10} maxLength={20000} defaultValue={s.steps.join("\n")} dir="auto" className="input" />
                </label>
                <button className="btn btn-secondary btn-sm justify-self-start">Save playbook</button>
                <p className="text-xs text-muted">Checklists already started keep the steps they started with.</p>
              </form>
              <form action={deleteSopAction} className="mt-3 border-t border-line pt-3">
                <input type="hidden" name="id" value={s.id} />
                <ConfirmButton message={`Remove the playbook “${s.title}”? Checklists already run stay in the history.`} className="btn btn-ghost btn-sm text-muted">
                  <Icon name="trash" size={14} /> Remove playbook
                </ConfirmButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
