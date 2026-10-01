import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { AssignmentForm } from "@/components/programme/AssignmentForm";
import { Card, Icon, PageHeader } from "@/components/ui";
import { SUBMISSION_STATUS, getAssignment, submissionsFor } from "@/lib/assignments";
import { ALLOWED_EXT } from "@/lib/attachments";
import { listCohorts } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { deleteAssignmentAction, recordSubmissionAction, reviewSubmissionAction } from "../actions";

export const metadata = { title: "Assignment" };

const CHIP = { submitted: "chip chip-warn", rework: "chip chip-danger", passed: "chip chip-ok" } as const;
const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");

export default async function AssignmentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const a = await getAssignment(db, id);
  if (!a) notFound();
  const [rows, batches] = await Promise.all([submissionsFor(db, id), listCohorts(db)]);
  const write = can(user.role, "programme:write");
  const max = a.rubric.reduce((s, c) => s + c.max, 0);

  return (
    <>
      <Link href={`/assignments?batch=${a.cohortId}`} className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> {a.cohort} assignments
      </Link>
      <PageHeader eyebrow={a.cohort} title={a.title} titleDir="auto" subtitle={`${a.dueAt ? `Due ${formatCairo(a.dueAt)} · ` : ""}pass mark ${a.passPct}% · rubric ${a.rubric.map((c) => `${c.name} (${c.max})`).join(", ")}`} />
      <Flash notice={sp.notice} error={sp.error} />
      {a.brief && (
        <Card title="Brief" icon="note" className="mb-5">
          <p className="whitespace-pre-line text-sm" dir="auto">
            {a.brief}
          </p>
        </Card>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title={`Students (${rows.length})`} icon="leads" bodyClass="p-0">
          <ul className="divide-y divide-line">
            {rows.map(({ enrolmentId, leadId, fullName, sub, reviewer }) => (
              <li key={enrolmentId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${leadId}`} className="link font-medium" dir="auto">
                    {fullName}
                  </Link>
                  {sub ? <span className={CHIP[sub.status]}>{SUBMISSION_STATUS[sub.status]}</span> : <span className="chip">Not submitted</span>}
                  {sub?.totalPct != null && <span className="num text-sm">{sub.totalPct}%</span>}
                  {sub && sub.attempt > 1 && <span className="text-xs text-muted">attempt {sub.attempt}</span>}
                </div>
                {sub && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    <span>Sent {formatCairo(sub.submittedAt)}</span>
                    {sub.attachmentId && (
                      <a href={`/files/${sub.attachmentId}`} className="link">
                        Download the file
                      </a>
                    )}
                    {sub.link && (
                      <a href={sub.link} target="_blank" rel="noreferrer" className="link">
                        Open the link
                      </a>
                    )}
                    {sub.reviewedAt && <span>Reviewed by {reviewer ?? "someone"} {formatCairo(sub.reviewedAt, false)}</span>}
                  </div>
                )}
                {sub?.note && (
                  <p className="mt-1 text-xs" dir="auto">
                    Student&rsquo;s note: {sub.note}
                  </p>
                )}
                {sub?.feedback && sub.status !== "submitted" && (
                  <p className="mt-1 whitespace-pre-line text-xs text-muted" dir="auto">
                    Feedback: {sub.feedback}
                  </p>
                )}
                {write && sub && sub.status === "submitted" && (
                  <form action={reviewSubmissionAction} className="mt-3 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
                    <input type="hidden" name="submissionId" value={sub.id} />
                    <input type="hidden" name="assignmentId" value={a.id} />
                    {a.rubric.map((c, i) => (
                      <label key={c.name} className="field">
                        {c.name} (0 to {c.max})
                        <input name={`score-${i}`} type="number" min={0} max={c.max} step={0.5} required className="input input-sm num" />
                      </label>
                    ))}
                    <label className="field sm:col-span-2">
                      Feedback for the student
                      <textarea name="feedback" rows={2} defaultValue={sub.feedback ?? ""} dir="auto" className="input" />
                    </label>
                    <div className="sm:col-span-2">
                      <button className="btn btn-primary btn-sm">Save review</button>
                      <span className="ml-2 text-xs text-muted">
                        Out of {max} points; {a.passPct}% passes, below asks for rework.
                      </span>
                    </div>
                  </form>
                )}
                {write && (!sub || sub.status === "rework") && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-fg">Record a submission they sent another way</summary>
                    <form action={recordSubmissionAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <input type="hidden" name="enrolmentId" value={enrolmentId} />
                      <label className="field">
                        File (up to 8 MB)
                        <input type="file" name="file" accept={ACCEPT} className="input input-sm" />
                      </label>
                      <label className="field">
                        or a link
                        <input name="link" type="url" dir="ltr" className="input input-sm" placeholder="https://" />
                      </label>
                      <button className="btn btn-secondary btn-sm">Record</button>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {write && (
          <div className="flex flex-col gap-5">
            <Card title="Edit assignment" icon="edit">
              <AssignmentForm a={a} batches={batches} />
            </Card>
            <form action={deleteAssignmentAction}>
              <input type="hidden" name="id" value={a.id} />
              <ConfirmButton message="Remove this assignment? Submitted work and reviews stay in the history." className="btn btn-ghost btn-sm">
                <Icon name="trash" size={14} /> Remove assignment
              </ConfirmButton>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
