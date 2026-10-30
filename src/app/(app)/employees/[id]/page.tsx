import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { TwoFactorGate } from "@/components/employee/TwoFactorGate";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ALLOWED_EXT } from "@/lib/attachments";
import { CONTACT_FIELDS, DOC_CATEGORIES, SENSITIVE_FIELDS, WORKER_TYPES, changeRequests, documentsFor, getEmployee, logRecordView, teamMemberOptions, type DocCategory } from "@/lib/employees";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { addDocumentAction, decideChangeAction, newDocumentVersionAction, saveEmployeeAction } from "../actions";

export const metadata = { title: "Employee record" };
const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");

export default async function EmployeeRecord(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("employee:manage");
  if (!user.twoFactor) return <TwoFactorGate title="Employee record" />;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const e = await getEmployee(db, id);
  if (!e) notFound();
  await logRecordView(db, user.id, id);
  const [docs, changes, people, members] = await Promise.all([
    documentsFor(db, id),
    changeRequests(db, { userId: id }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    teamMemberOptions(db),
  ]);
  const pending = changes.filter(({ r }) => r.status === "pending");

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/employees" className="hover:text-fg">
            Employees
          </Link>
        }
        title={e.user.name}
        titleDir="auto"
        subtitle={`${e.user.role} · ${e.user.email}${e.user.active ? "" : " · inactive"}${id === user.id ? " · this is you" : ""}`}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          {pending.length > 0 && (
            <Card title={`Change requests (${pending.length})`} icon="reply">
              <ul className="flex flex-col gap-4">
                {pending.map(({ r }) => (
                  <li key={r.id} className="text-sm">
                    <p dir="auto">
                      <span className="font-medium">{SENSITIVE_FIELDS[r.field as keyof typeof SENSITIVE_FIELDS] ?? r.field}</span> should be “{r.value}”
                      {r.reason && <span className="text-muted"> · {r.reason}</span>}
                    </p>
                    {id === user.id ? (
                      <p className="mt-1 text-xs text-muted">Another owner decides changes to your own record.</p>
                    ) : (
                      <form action={decideChangeAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="userId" value={id} />
                        <label className="field">
                          Decision
                          <select name="decision" className="input input-sm">
                            <option value="apply">Make the change</option>
                            <option value="decline">Decline</option>
                          </select>
                        </label>
                        <label className="field min-w-0 flex-1">
                          Note (needed to decline)
                          <input name="note" maxLength={1000} className="input input-sm" />
                        </label>
                        <button className="btn btn-primary btn-sm">Send</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Record and terms" icon="edit">
            <form action={saveEmployeeAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="userId" value={id} />
              <label className="field">
                Worker type
                <select name="workerType" defaultValue={e.workerType} className="input input-sm">
                  {Object.entries(WORKER_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Job title
                <input name="jobTitle" defaultValue={e.jobTitle ?? ""} maxLength={200} className="input input-sm" dir="auto" />
              </label>
              <label className="field">
                Start date
                <input name="startDate" type="date" defaultValue={e.startDate ?? ""} className="input input-sm" />
              </label>
              <label className="field">
                End date
                <input name="endDate" type="date" defaultValue={e.endDate ?? ""} className="input input-sm" />
              </label>
              <label className="field">
                Manager
                <select name="managerId" defaultValue={e.managerId ?? ""} className="input input-sm">
                  <option value="">None</option>
                  {people
                    .filter((p) => p.id !== id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Their pay in the books (team member)
                <select name="teamMemberId" defaultValue={e.teamMemberId ?? ""} className="input input-sm">
                  <option value="">Not linked</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field sm:col-span-2">
                Pay terms
                <input name="payTerms" defaultValue={e.payTerms ?? ""} maxLength={400} className="input input-sm" placeholder="e.g. Monthly salary, or per case" dir="auto" />
              </label>
              <label className="field">
                Pay (EGP)
                <input name="payAmountEgp" type="number" min={0} step={1} defaultValue={e.payAmountEgp ?? ""} className="input input-sm num" />
              </label>
              <label className="field">
                Pay schedule
                <input name="paySchedule" defaultValue={e.paySchedule ?? ""} maxLength={200} className="input input-sm" placeholder="e.g. Last working day of the month" dir="auto" />
              </label>
              <label className="field">
                Notice period
                <input name="noticePeriod" defaultValue={e.noticePeriod ?? ""} maxLength={200} className="input input-sm" dir="auto" />
              </label>
              <div className="sm:col-span-2">
                <button className="btn btn-primary btn-sm">{e.exists ? "Save the record" : "Create the record"}</button>
              </div>
            </form>
          </Card>

          <Card title="Contact details" icon="user">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {(Object.keys(CONTACT_FIELDS) as (keyof typeof CONTACT_FIELDS)[]).map((k) => (
                <div key={k}>
                  <dt className="text-muted">{CONTACT_FIELDS[k]}</dt>
                  <dd dir="auto">{e[k] || <span className="text-muted">Not set</span>}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">The person keeps these up to date from their portal.</p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title={`Documents (${docs.filter((d) => d.status === "current").length})`} icon="download" bodyClass="p-0">
            {docs.length === 0 ? (
              <EmptyState icon="note" title="No documents yet" />
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id} className={`px-4 py-2.5 text-sm ${d.status !== "current" ? "opacity-70" : ""}`}>
                    <div className="flex items-center gap-2">
                      <Link href={`/me/documents/${d.id}`} className="link min-w-0 flex-1 truncate" dir="auto">
                        {d.title}
                      </Link>
                      <span className={`chip ${d.status !== "current" ? "" : d.acknowledgedAt ? "chip-ok" : d.needsAck ? "chip-warn" : ""}`}>
                        {d.status !== "current" ? "Replaced" : d.acknowledgedAt ? "Accepted" : d.needsAck ? "Not accepted" : "On file"}
                      </span>
                    </div>
                    <div className="text-xs text-muted">
                      {DOC_CATEGORIES[d.category as DocCategory] ?? d.category} · version {d.version} · {formatCairo(d.createdAt, false)}
                      {d.acknowledgedAt && ` · accepted ${formatCairo(d.acknowledgedAt, false)}`}
                    </div>
                    {d.status === "current" && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted hover:text-fg">Upload a new version</summary>
                        <form action={newDocumentVersionAction} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="userId" value={id} />
                          <label className="field">
                            New version of {d.title}
                            <input type="file" name="file" required accept={ACCEPT} className="input input-sm py-1.5" />
                          </label>
                          <button className="btn btn-secondary btn-sm self-start">Add version {d.version + 1}</button>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Add a document" icon="upload">
            <form action={addDocumentAction} className="flex flex-col gap-3">
              <input type="hidden" name="userId" value={id} />
              <label className="field">
                Kind
                <select name="category" defaultValue="contract" className="input input-sm">
                  {Object.entries(DOC_CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Title
                <input name="title" required maxLength={160} className="input input-sm" placeholder="e.g. Employment contract" dir="auto" />
              </label>
              <label className="field">
                Document
                <input type="file" name="file" required accept={ACCEPT} className="input input-sm py-1.5" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="needsAck" defaultChecked className="check" /> Ask them to read and accept it
              </label>
              <button className="btn btn-primary btn-sm self-start">Add the document</button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
