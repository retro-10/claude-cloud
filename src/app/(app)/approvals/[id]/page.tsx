import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { STATUS_LABEL, canDecide, getRequest, typeOf } from "@/lib/approvals";
import { campaignStats } from "@/lib/campaigns";
import { STATUS_LABEL as LEDGER_STATUS } from "@/lib/finance";
import { egp } from "@/lib/cohort-format";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { cancelApprovalAction, decideApprovalAction, replyApprovalAction } from "../actions";

export const metadata = { title: "Request · Approvals" };

const ACTION: Record<string, string> = {
  submit: "asked",
  approve: "approved",
  reject: "rejected",
  needs_info: "asked for more information",
  reply: "answered",
  cancel: "withdrew the request",
};
const TONE: Record<string, string> = { pending: "chip-warn", needs_info: "chip-warn", approved: "chip-ok", rejected: "chip-danger", cancelled: "" };

export default async function RequestPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("approval:submit");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const r = await getRequest(db, id, { id: user.id, name: user.name, isOwner: can(user.role, "settings:write"), isFinance: can(user.role, "finance:read") });
  if (!r) notFound();
  const decider = canDecide(r, user.id);
  const mine = r.requesterId === user.id;
  const open = r.status === "pending" || r.status === "needs_info";
  const books = can(user.role, "finance:read");
  // for whoever decides: would this take its campaign past the budget? (the waiting amount already counts this one)
  const [camp] = r.campaign && open && (decider || books) ? await campaignStats(db, r.campaign.id) : [];
  const over = camp && camp.remainingEgp != null && camp.remainingEgp < 0 ? -camp.remainingEgp : 0;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/approvals" className="hover:text-fg">
            Approvals
          </Link>
        }
        title={r.title}
        titleDir="auto"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`chip ${TONE[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            <span>
              {typeOf(r.type).label} · asked by {r.requester} on {formatCairo(r.createdAt)}
            </span>
          </span>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <Card title="The request" icon="note">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {r.amountEgp != null && (
                <div>
                  <dt className="text-muted">Amount</dt>
                  <dd className="num text-lg font-semibold">{egp(r.amountEgp)}</dd>
                </div>
              )}
              {r.category && (
                <div>
                  <dt className="text-muted">Category</dt>
                  <dd>{r.category}</dd>
                </div>
              )}
              {r.campaign && (
                <div>
                  <dt className="text-muted">Campaign</dt>
                  <dd>
                    <Link href={`/growth/campaigns/${r.campaign.id}`} className="link">
                      {r.campaign.name}
                    </Link>
                  </dd>
                </div>
              )}
              {r.startsOn && (
                <div>
                  <dt className="text-muted">Days</dt>
                  <dd>{r.endsOn && r.endsOn !== r.startsOn ? `${r.startsOn} to ${r.endsOn}` : r.startsOn}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted">Can approve</dt>
                <dd>{r.approvers.map((a) => a.name).join(", ")}</dd>
              </div>
              {r.decider && (
                <div>
                  <dt className="text-muted">Decided by</dt>
                  <dd>
                    {r.decider}
                    {r.decidedAt && `, ${formatCairo(r.decidedAt)}`}
                  </dd>
                </div>
              )}
            </dl>
            {r.details && (
              <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-sm" dir="auto">
                {r.details}
              </p>
            )}
            {r.files.length > 0 && (
              <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-4 text-sm">
                {r.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <Icon name="download" size={14} className="text-muted" />
                    <a href={`/files/${f.id}`} className="link" target="_blank" rel="noopener noreferrer">
                      {f.fileName}
                    </a>
                    <span className="text-xs text-muted">{f.note ?? "File"}</span>
                  </li>
                ))}
              </ul>
            )}
            {over > 0 && camp && (
              <p role="status" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                With this request, {camp.label} is {egp(over)} over its {egp(camp.budgetEgp ?? 0)} budget (paid, owed and waiting requests together).
              </p>
            )}
            {r.ledger && (
              <p className="mt-4 text-sm text-ok">
                <Icon name="check" size={14} className="-mt-0.5 mr-1 inline" />
                In the ledger as {LEDGER_STATUS[r.ledger.status].toLowerCase()} · {r.ledger.category}.
                {books && (
                  <>
                    {" "}
                    <Link href={`/finance/ledger?q=${encodeURIComponent(`Request #${r.id}`)}`} className="link">
                      Open in the ledger
                    </Link>
                  </>
                )}
              </p>
            )}
            {r.calendarEventId && (
              <p className="mt-4 text-sm text-ok">
                <Icon name="calendar" size={14} className="-mt-0.5 mr-1 inline" />
                On the team calendar as leave.
              </p>
            )}
          </Card>
          <Card title="History" icon="history">
            <ol className="flex flex-col gap-3">
              {r.events.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="font-medium">{e.who}</span> {ACTION[e.action] ?? e.action}
                  <span className="text-muted"> · {formatCairo(e.createdAt)}</span>
                  {e.note && (
                    <p className="mt-1 whitespace-pre-line rounded-lg bg-raised px-3 py-2" dir="auto">
                      {e.note}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted">This history cannot be edited or deleted.</p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {decider && r.status === "pending" && (
            <Card title="Your decision" icon="check">
              <form action={decideApprovalAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={r.id} />
                <fieldset className="flex flex-col gap-2 text-sm">
                  <legend className="sr-only">Decision</legend>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="decision" value="approve" defaultChecked className="check" /> Approve
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="decision" value="needs_info" className="check" /> Ask a question
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="decision" value="reject" className="check" /> Reject
                  </label>
                </fieldset>
                <label className="field">
                  Note (needed to reject or ask a question)
                  <textarea name="note" rows={3} maxLength={2000} className="input min-h-20 py-2" />
                </label>
                <button className="btn btn-primary btn-sm self-start">
                  <Icon name="check" size={14} /> Send decision
                </button>
              </form>
            </Card>
          )}
          {decider && r.status === "needs_info" && (
            <Card title="Waiting for an answer" icon="hourglass">
              <p className="text-sm text-muted">{r.requester} has been asked for more information. It comes back here when they answer.</p>
            </Card>
          )}
          {mine && r.status === "needs_info" && (
            <Card title="Answer the question" icon="reply">
              <form action={replyApprovalAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={r.id} />
                <label className="field">
                  Your answer
                  <textarea name="note" rows={3} required maxLength={2000} className="input min-h-20 py-2" />
                </label>
                <button className="btn btn-primary btn-sm self-start">Send answer</button>
              </form>
            </Card>
          )}
          {mine && open && (
            <form action={cancelApprovalAction}>
              <input type="hidden" name="id" value={r.id} />
              <ConfirmButton message="Withdraw this request? The approvers will no longer see it in their queue." className="btn btn-ghost btn-sm">
                Withdraw the request
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
