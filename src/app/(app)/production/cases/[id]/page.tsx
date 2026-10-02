import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { FilesPanel } from "@/components/FilesPanel";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { listAttachments } from "@/lib/attachments";
import { CASE_STATUS, OPEN_STATUSES, canWorkOnCase, checklistFor, getCase, listDesigners, seesMoney } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { assignCaseAction, cancelCaseAction, deliverCaseAction, reviewQcAction, sendToQcAction, startCaseAction, updateCaseAction } from "../../actions";

export const metadata = { title: "Case" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

export default async function CasePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("production:read");
  const c = await getCase(db, Number(id), user);
  if (!c) notFound();
  const manage = can(user.role, "production:manage");
  const money = seesMoney(user);
  const mine = c.designerId === user.id;
  const open = OPEN_STATUSES.includes(c.status);
  const [files, canWork, designers, checklist] = await Promise.all([
    listAttachments(db, { caseId: c.id }),
    canWorkOnCase(db, c.id, user),
    manage ? listDesigners(db) : Promise.resolve([]),
    checklistFor(db, c.caseTypeId),
  ]);
  const late = open && c.dueAt < new Date();
  const back = `/production/cases/${c.id}`;
  const canQc = manage && c.status === "qc" && !c.qcPassedAt && !mine;

  return (
    <>
      <Link href="/production" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Cases
      </Link>
      <PageHeader
        eyebrow={`${c.client} · ${c.type} × ${c.units}`}
        title={c.code}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className={c.status === "cancelled" ? "chip chip-danger" : c.status === "delivered" || c.status === "invoiced" ? "chip chip-ok" : "chip chip-brand"}>{CASE_STATUS[c.status]}</span>
            {c.rush && <span className="chip chip-warn">rush</span>}
            <span className={late ? "font-medium text-danger" : ""}>
              Due {formatCairo(c.dueAt)}
              {late ? " · late" : ""}
            </span>
          </span>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <Card title="The case" icon="layers">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Client</dt>
                <dd dir="auto">{manage || money ? <Link href={`/production/clients/${c.clientId}`} className="link">{c.client}</Link> : c.client}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Client&apos;s reference</dt>
                <dd dir="auto">{c.reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Received</dt>
                <dd>{formatCairo(c.receivedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Designer</dt>
                <dd>{c.designer ?? "Not assigned"}</dd>
              </div>
              {money && (
                <div>
                  <dt className="text-xs text-muted">Price</dt>
                  <dd className="num">{egp(c.priceEgp)}</dd>
                </div>
              )}
              {(money || mine) && (
                <div>
                  <dt className="text-xs text-muted">Designer pay</dt>
                  <dd className="num">{egp(c.designerPayEgp)}</dd>
                </div>
              )}
              {c.deliveredAt && (
                <div>
                  <dt className="text-xs text-muted">Delivered</dt>
                  <dd>
                    {formatCairo(c.deliveredAt)}
                    {c.deliveredAt > c.dueAt ? <span className="text-danger"> · late</span> : ""}
                  </dd>
                </div>
              )}
            </dl>
            {c.notes && (
              <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm" dir="auto">
                {c.notes}
              </p>
            )}
          </Card>

          <Card title="Design files" icon="layers">
            <FilesPanel rows={files} back={back} caseId={c.id} canWrite={canWork} me={user.id} isOwner={manage} />
            {!canWork && mine && <p className="mt-2 text-xs text-muted">Files can be changed while the case is assigned or being designed.</p>}
          </Card>

          {c.qcChecks && (
            <Card title={c.qcPassedAt ? "QC: passed" : "QC: sent back"} icon="check">
              <ul className="grid gap-1 text-sm">
                {c.qcChecks.map((q) => (
                  <li key={q.item} className="flex items-center gap-2">
                    <Icon name={q.ok ? "check" : "x"} size={14} className={q.ok ? "text-ok" : "text-danger"} />
                    <span className="sr-only">{q.ok ? "Right:" : "To fix:"}</span>
                    {q.item}
                  </li>
                ))}
              </ul>
              {c.qcNote && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-raised p-3 text-sm" dir="auto">
                  {c.qcNote}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                {c.qcFails ? `Sent back ${c.qcFails} time${c.qcFails === 1 ? "" : "s"}.` : "Passed the first time."}
              </p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Next step" icon="flag">
            <div className="flex flex-col gap-3">
              {c.status === "assigned" && (mine || manage) && (
                <form action={startCaseAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn btn-primary btn-sm">Start designing</button>
                </form>
              )}
              {c.status === "designing" && (mine || manage) && (
                <form action={sendToQcAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn btn-primary btn-sm">Send to QC</button>
                  <p className="mt-1 text-xs text-muted">Add the design files first.</p>
                </form>
              )}
              {c.status === "qc" && !c.qcPassedAt && !canQc && <p className="text-sm text-muted">Waiting for QC{mine ? " (someone else checks your work)" : ""}.</p>}
              {canQc && (
                <form action={reviewQcAction} className="grid gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="count" value={checklist.length} />
                  <fieldset className="grid gap-1.5">
                    <legend className="mb-1 text-sm font-medium">QC checklist: tick what is right</legend>
                    {checklist.map((item, i) => (
                      <label key={item} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name={`qc-${i}`} className="mt-0.5" /> {item}
                      </label>
                    ))}
                  </fieldset>
                  <label className="field">
                    What to fix (needed if anything is not ticked)
                    <textarea name="note" rows={3} maxLength={2000} dir="auto" className="input" />
                  </label>
                  <button className="btn btn-primary btn-sm self-start justify-self-start">Save the QC result</button>
                  <p className="text-xs text-muted">Everything ticked passes it; otherwise it goes back to the designer.</p>
                </form>
              )}
              {c.status === "qc" && c.qcPassedAt && manage && (
                <form action={deliverCaseAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn btn-primary btn-sm">Mark delivered to the client</button>
                  {c.designerPayEgp > 0 && <p className="mt-1 text-xs text-muted">The designer&apos;s pay is added to the ledger as owed.</p>}
                </form>
              )}
              {c.status === "delivered" && <p className="text-sm text-muted">Delivered. It goes on the client&apos;s next invoice.</p>}
              {c.status === "invoiced" && <p className="text-sm text-muted">Invoiced.</p>}
              {c.status === "cancelled" && <p className="text-sm text-muted">Cancelled.</p>}
              {c.status === "received" && !manage && <p className="text-sm text-muted">Not assigned yet.</p>}
            </div>
          </Card>

          {manage && ["received", "assigned", "designing"].includes(c.status) && (
            <Card title="Designer" icon="user">
              <form action={assignCaseAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={c.id} />
                <label className="field min-w-0 flex-1">
                  Assigned to
                  <select name="designerId" defaultValue={c.designerId ?? ""} className="input input-sm">
                    <option value="">Nobody yet</option>
                    {designers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-secondary btn-sm">Save</button>
              </form>
            </Card>
          )}

          {manage && open && (
            <Card title="Details" icon="edit">
              <form action={updateCaseAction} className="grid gap-3">
                <input type="hidden" name="id" value={c.id} />
                <label className="field">
                  Client&apos;s reference
                  <input name="reference" maxLength={120} defaultValue={c.reference ?? ""} dir="auto" className="input input-sm" />
                </label>
                <label className="field">
                  Due
                  <input name="dueAt" type="datetime-local" required defaultValue={toCairoLocalInput(c.dueAt)} className="input input-sm" />
                </label>
                <label className="field">
                  Notes
                  <textarea name="notes" rows={3} maxLength={4000} defaultValue={c.notes ?? ""} dir="auto" className="input" />
                </label>
                <button className="btn btn-secondary btn-sm self-start justify-self-start">Save details</button>
              </form>
              <details className="mt-4 border-t border-line pt-3">
                <summary className="cursor-pointer text-sm text-muted">Cancel this case</summary>
                <form action={cancelCaseAction} className="mt-2 grid gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="field">
                    Reason
                    <input name="reason" required maxLength={300} className="input input-sm" />
                  </label>
                  <button className="btn btn-danger btn-sm self-start justify-self-start">Cancel the case</button>
                </form>
              </details>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
