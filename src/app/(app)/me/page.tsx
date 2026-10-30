import Link from "next/link";
import { db } from "@/db";
import { TwoFactorGate } from "@/components/employee/TwoFactorGate";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import {
  STATUS_LABEL as APPROVAL_STATUS,
  myRequests,
  typeOf,
} from "@/lib/approvals";
import { egp } from "@/lib/cohort-format";
import {
  CONTACT_FIELDS,
  DOC_CATEGORIES,
  SENSITIVE_FIELDS,
  WORKER_TYPES,
  changeRequests,
  documentsFor,
  getEmployee,
  myPay,
  type DocCategory,
} from "@/lib/employees";
import { STATUS_LABEL as LEDGER_STATUS } from "@/lib/finance";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { taskCounts } from "@/lib/tasks";
import { formatCairo } from "@/lib/time";
import { requestChangeAction, updateContactAction } from "./actions";

export const metadata = { title: "My portal" };

const CHANGE_LABEL: Record<string, string> = {
  pending: "Waiting",
  applied: "Done",
  declined: "Declined",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd dir="auto">{value || <span className="text-muted">Not set</span>}</dd>
    </div>
  );
}

export default async function MyPortal(props: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await requirePageCan("employee:self");
  if (!user.twoFactor) return <TwoFactorGate title="My portal" />;
  const [me, docs, changes, requests, pay, tasks] = await Promise.all([
    getEmployee(db, user.id),
    documentsFor(db, user.id),
    changeRequests(db, { userId: user.id }),
    myRequests(db, user.id, 10),
    myPay(db, user.id),
    can(user.role, "task:write") || can(user.role, "hq:read")
      ? taskCounts(db, user.id)
      : Promise.resolve(null),
  ]);
  if (!me) return null;
  const current = docs.filter((d) => d.status === "current");
  const toAccept = current.filter(
    (d) => d.needsAck && !d.acknowledgedAt,
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Employee records"
        title="My portal"
        subtitle="Your profile, terms and documents. Only you and the owners can see this page; finance sees your pay terms."
      />
      <Flash notice={sp.notice} error={sp.error} />
      {toAccept > 0 && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
        >
          {toAccept} document{toAccept === 1 ? "" : "s"} to read and accept,
          below.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div id="profile" className="scroll-mt-24">
          <Card title="My profile" icon="user" className="h-full">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Name" value={me.user.name} />
              <Row label="Sign-in email" value={me.user.email} />
              <Row label="Job title" value={me.jobTitle} />
              <Row
                label="Worker type"
                value={me.exists ? WORKER_TYPES[me.workerType] : null}
              />
              <Row label="Started" value={me.startDate} />
              <Row label="Manager" value={me.manager} />
            </dl>
            <form
              action={updateContactAction}
              className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
            >
              <p className="text-sm font-medium sm:col-span-2">
                Contact details (yours to keep up to date)
              </p>
              {(
                Object.keys(CONTACT_FIELDS) as (keyof typeof CONTACT_FIELDS)[]
              ).map((k) => (
                <label
                  key={k}
                  className={`field ${k === "address" ? "sm:col-span-2" : ""}`}
                >
                  {CONTACT_FIELDS[k]}
                  <input
                    name={k}
                    defaultValue={me[k] ?? ""}
                    maxLength={k === "address" ? 400 : 200}
                    type={k === "personalEmail" ? "email" : "text"}
                    className="input input-sm"
                    dir="auto"
                  />
                </label>
              ))}
              <button className="btn btn-primary btn-sm self-start">
                Save contact details
              </button>
            </form>
          </Card>
        </div>

        <Card title="My terms" icon="note">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Pay terms" value={me.payTerms} />
            <Row
              label="Pay"
              value={me.payAmountEgp != null ? egp(me.payAmountEgp) : null}
            />
            <Row label="Pay schedule" value={me.paySchedule} />
            <Row label="Notice period" value={me.noticePeriod} />
            <Row
              label="Current contract"
              value={(() => {
                const c = current.find((d) => d.category === "contract");
                return c
                  ? `${c.title}, version ${c.version} · ${c.acknowledgedAt ? `accepted ${formatCairo(c.acknowledgedAt, false)}` : c.needsAck ? "waiting for you to accept" : "on file"}`
                  : null;
              })()}
            />
          </dl>
          {!me.exists && (
            <p className="mt-4 text-sm text-muted">
              An owner has not filled in your record yet.
            </p>
          )}
        </Card>

        <Card
          title={`My documents (${current.length})`}
          icon="download"
          bodyClass="p-0"
        >
          {docs.length === 0 ? (
            <EmptyState icon="note" title="No documents yet">
              Your contract, letters and policies appear here when an owner adds
              them.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${d.status !== "current" ? "opacity-70" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/me/documents/${d.id}`}
                      className="link truncate"
                      dir="auto"
                    >
                      {d.title}
                    </Link>
                    <div className="text-xs text-muted">
                      {DOC_CATEGORIES[d.category as DocCategory] ?? d.category}{" "}
                      · version {d.version} · {formatCairo(d.createdAt, false)}
                    </div>
                  </div>
                  {d.status !== "current" ? (
                    <span className="chip">Replaced</span>
                  ) : d.acknowledgedAt ? (
                    <span className="chip chip-ok">Accepted</span>
                  ) : d.needsAck ? (
                    <span className="chip chip-warn">To accept</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div id="requests" className="scroll-mt-24">
          <Card title="My requests" icon="check" className="h-full">
            <ul className="mb-4 flex flex-col gap-2 text-sm">
              {requests.length === 0 && changes.length === 0 && (
                <li className="text-muted">No requests yet.</li>
              )}
              {requests.map((r) => (
                <li
                  key={`a${r.id}`}
                  className="flex items-center justify-between gap-2"
                >
                  <Link
                    href={`/approvals/${r.id}`}
                    className="link truncate"
                    dir="auto"
                  >
                    {typeOf(r.type).label}: {r.title}
                  </Link>
                  <span className="chip">
                    {APPROVAL_STATUS[r.status] ?? r.status}
                  </span>
                </li>
              ))}
              {changes.map(({ r }) => (
                <li
                  key={`c${r.id}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate" dir="auto">
                    Change{" "}
                    {SENSITIVE_FIELDS[
                      r.field as keyof typeof SENSITIVE_FIELDS
                    ]?.toLowerCase() ?? r.field}{" "}
                    to “{r.value}”
                    {r.note && <span className="text-muted"> · {r.note}</span>}
                  </span>
                  <span
                    className={`chip ${r.status === "applied" ? "chip-ok" : r.status === "declined" ? "chip-danger" : "chip-warn"}`}
                  >
                    {CHANGE_LABEL[r.status] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/approvals/new?type=leave"
                className="btn btn-secondary btn-sm"
              >
                Ask for leave
              </Link>
              <Link
                href="/approvals/new?type=expense"
                className="btn btn-secondary btn-sm"
              >
                Claim an expense
              </Link>
            </div>
            <details className="mt-4 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Ask to change my details
              </summary>
              <form
                action={requestChangeAction}
                className="mt-3 grid gap-3 sm:grid-cols-2"
              >
                <label className="field">
                  What
                  <select name="field" required className="input input-sm">
                    {Object.entries(SENSITIVE_FIELDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Should be
                  <input
                    name="value"
                    required
                    maxLength={400}
                    className="input input-sm"
                    dir="auto"
                  />
                </label>
                <label className="field sm:col-span-2">
                  Why (optional)
                  <input
                    name="reason"
                    maxLength={1000}
                    className="input input-sm"
                    dir="auto"
                  />
                </label>
                <button className="btn btn-primary btn-sm self-start">
                  Send to the owners
                </button>
              </form>
            </details>
          </Card>
        </div>

        <Card title="My work" icon="list">
          <ul className="flex flex-col gap-2 text-sm">
            {tasks && (
              <li>
                <Link href="/tasks?who=mine" className="link">
                  {tasks.mine} open task{tasks.mine === 1 ? "" : "s"}
                </Link>
                {tasks.mineOverdue > 0 && (
                  <span className="text-warn">
                    {" "}
                    · {tasks.mineOverdue} overdue
                  </span>
                )}
              </li>
            )}
            {can(user.role, "production:work") && (
              <li>
                <Link href="/production" className="link">
                  My production cases
                </Link>
              </li>
            )}
            {can(user.role, "programme:write") && (
              <li>
                <Link href="/classes" className="link">
                  My classes
                </Link>
              </li>
            )}
            <li>
              <Link href="/calendar" className="link">
                My hours on the team calendar
              </Link>
            </li>
          </ul>
        </Card>

        <Card title="My pay" icon="trend" bodyClass="p-0">
          {pay === null ? (
            <p className="p-4 text-sm text-muted">
              Your pay entries show here once an owner links your record to the
              books.
            </p>
          ) : pay.length === 0 ? (
            <p className="p-4 text-sm text-muted">No pay entries yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pay.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {p.entry}
                  </span>
                  <span className="text-xs text-muted">
                    {formatCairo(p.date ?? p.createdAt, false)}
                  </span>
                  <span className="chip">{LEDGER_STATUS[p.status]}</span>
                  <span className="num">{egp(p.amountEgp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted">
        <Icon name="shield" size={12} className="-mt-0.5 mr-1 inline" />
        Nothing on this page goes to the AI assistant, the exports or Notion.
      </p>
    </>
  );
}
