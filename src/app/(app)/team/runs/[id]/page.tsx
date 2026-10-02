import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { getRun } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { cancelRunAction, tickStepAction } from "../../actions";

export const metadata = { title: "Checklist · Team" };

export default async function RunPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const r = await getRun(db, Number(id));
  if (!r) notFound();
  const write = can(user.role, "task:write") && !r.cancelledAt;
  const done = r.steps.filter((s) => s.doneAt).length;
  return (
    <>
      <Link href="/team/runs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Checklists
      </Link>
      <PageHeader
        eyebrow={
          <Link href={`/team/sops/${r.sopId}`} className="hover:underline">
            {r.sopTitle}
          </Link>
        }
        title={r.title}
        titleDir="auto"
        subtitle={[
          r.assignee ? `Run by ${r.assignee}` : "Nobody assigned",
          r.dueAt ? `due ${formatCairo(r.dueAt, false)}` : null,
          r.cancelledAt ? "cancelled" : r.completedAt ? `finished ${formatCairo(r.completedAt)}` : `${done} of ${r.steps.length} done`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Steps" icon="check" bodyClass="p-0">
          <ol className="divide-y divide-line">
            {r.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                {write ? (
                  <form action={tickStepAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="index" value={i} />
                    <input type="hidden" name="done" value={s.doneAt ? "0" : "1"} />
                    <button
                      className={`grid h-6 w-6 place-items-center rounded-md border ${s.doneAt ? "border-ok bg-ok/15 text-ok" : "border-line text-transparent hover:border-brand"}`}
                      aria-pressed={!!s.doneAt}
                      aria-label={`Step ${i + 1}: ${s.text}`}
                    >
                      <Icon name="check" size={14} />
                    </button>
                  </form>
                ) : (
                  <Icon name={s.doneAt ? "check" : "clock"} size={16} className={s.doneAt ? "text-ok" : "text-muted"} />
                )}
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${s.doneAt ? "text-muted line-through" : ""}`} dir="auto">
                    <span className="mr-1 text-muted">{i + 1}.</span>
                    {s.text}
                  </div>
                  {s.doneAt && <div className="text-xs text-muted">done {formatCairo(new Date(s.doneAt))}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="About" icon="note">
          <dl className="grid gap-2 text-sm">
            {r.cohort && (
              <div>
                <dt className="text-xs text-muted">Batch</dt>
                <dd>
                  <Link href={`/cohorts/${r.cohortId}`} className="link">
                    {r.cohort}
                  </Link>
                </dd>
              </div>
            )}
            {r.lead && (
              <div>
                <dt className="text-xs text-muted">About</dt>
                <dd>
                  <Link href={`/leads/${r.leadId}`} className="link" dir="auto">
                    {r.lead}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">Started</dt>
              <dd>{formatCairo(r.startedAt)}</dd>
            </div>
          </dl>
          {write && !r.completedAt && (
            <form action={cancelRunAction} className="mt-4 border-t border-line pt-3">
              <input type="hidden" name="id" value={r.id} />
              <ConfirmButton message="Cancel this checklist? It stays in the history as cancelled." className="btn btn-ghost btn-sm text-muted">
                Cancel the checklist
              </ConfirmButton>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
