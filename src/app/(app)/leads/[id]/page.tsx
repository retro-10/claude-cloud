import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activities, cadenceTemplates, consults, followUps, leads, lostReasons, sources, stageEvents, stages, users } from "@/db/schema";
import { LeadForm } from "@/components/LeadForm";
import { ConsultsPanel } from "@/components/ConsultsPanel";
import { SpeedBadge } from "@/components/SpeedBadge";
import { whatsappUrl } from "@/lib/phone";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { addActivity, changeStageAction, deleteLeadAction, restoreLeadAction } from "../actions";
import {
  addFollowUpAction,
  applyCadenceAction,
  cancelFollowUpAction,
  completeFollowUpAction,
  rescheduleFollowUpAction,
} from "../../followups/actions";

const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

export default async function LeadPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();

  const [stageList, sourceList, ownerList, reasons, acts, events, cons, fus, tpls] = await Promise.all([
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.id)),
    db.select({ a: activities, by: users.name }).from(activities).leftJoin(users, eq(users.id, activities.byUserId)).where(eq(activities.leadId, id)),
    db.select({ e: stageEvents, by: users.name }).from(stageEvents).leftJoin(users, eq(users.id, stageEvents.byUserId)).where(eq(stageEvents.leadId, id)),
    db.select().from(consults).where(eq(consults.leadId, id)),
    db.select().from(followUps).where(eq(followUps.leadId, id)).orderBy(desc(followUps.dueAt)),
    db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id)),
  ]);
  const openFus = fus.filter((f) => !f.doneAt && !f.cancelledAt).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  const stageLabel = (k: string | null) => stageList.find((s) => s.key === k)?.label ?? k ?? "";
  type Item = { at: Date; kind: string; text: string; body?: string | null; by?: string | null };
  const timeline: Item[] = [
    ...acts.map(({ a, by }) => ({
      at: a.at,
      kind: a.type,
      text: a.type === "note" ? "Note" : `${a.type} ${a.direction === "in" ? "received" : a.direction === "out" ? "sent" : ""}`.trim(),
      body: a.body,
      by,
    })),
    ...events.map(({ e, by }) => ({
      at: e.at,
      kind: "stage",
      text: e.fromStage ? `Stage: ${stageLabel(e.fromStage)} → ${stageLabel(e.toStage)}` : `Created as ${stageLabel(e.toStage)}`,
      by,
    })),
    ...cons.map((c) => ({
      at: c.scheduledAt,
      kind: "consult",
      text: `Consult ${c.held ? "held" : "scheduled"}${c.outcome ? ` · ${c.outcome.replace("_", " ")}` : ""}`,
      body: c.notes,
    })),
    ...fus.map((f) => ({
      at: f.dueAt,
      kind: "follow-up",
      text: `Follow-up due${f.doneAt ? " (done)" : f.cancelledAt ? " (cancelled)" : ""}`,
      body: f.note,
    })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());

  const canWrite = can(user.role, "lead:write") && !lead.deletedAt;
  const wa = whatsappUrl(lead.phoneWhatsapp);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl" dir="auto">
            {lead.fullName}
          </h1>
          <SpeedBadge createdAt={lead.createdAt} firstContactAt={lead.firstContactAt} />
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-auto rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">
              WhatsApp
            </a>
          )}
        </div>

        {lead.deletedAt && (
          <div className="mb-3 flex items-center gap-3 rounded border border-danger/40 bg-danger/10 p-3 text-sm">
            This lead is deleted.
            {can(user.role, "lead:delete") && (
              <form action={restoreLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <button className="underline">Restore</button>
              </form>
            )}
          </div>
        )}
        {searchParams.error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {searchParams.error}
          </p>
        )}

        <dl className="mb-4 grid grid-cols-3 gap-2 text-xs text-muted">
          <div>
            <dt>Created</dt>
            <dd className="text-fg">{formatCairo(lead.createdAt)}</dd>
          </div>
          <div>
            <dt>First contact</dt>
            <dd className="text-fg">{formatCairo(lead.firstContactAt) || "—"}</dd>
          </div>
          <div>
            <dt>First reply</dt>
            <dd className="text-fg">{formatCairo(lead.firstReplyAt) || "—"}</dd>
          </div>
        </dl>

        <form action={changeStageAction} className="mb-4 flex flex-wrap items-end gap-2 rounded border border-line bg-surface p-3">
          <input type="hidden" name="id" value={lead.id} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            Stage
            <select name="stage" defaultValue={lead.stage} disabled={!canWrite} className={box}>
              {stageList.map((s) => (
                <option key={s.key} value={s.key} disabled={s.kind === "won" && lead.stage !== s.key}>
                  {s.label}
                  {s.kind === "won" ? " (enrol from Pipeline)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Lost reason (only if Lost)
            <select name="lostReasonId" defaultValue={lead.lostReasonId ?? ""} disabled={!canWrite} className={box}>
              <option value="">—</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {canWrite && <button className="rounded border border-line px-3 py-1.5 text-sm">Move</button>}
        </form>

        <LeadForm lead={lead} sources={sourceList} owners={ownerList} readOnly={!canWrite} />

        {can(user.role, "lead:delete") && !lead.deletedAt && (
          <form action={deleteLeadAction} className="mt-6">
            <input type="hidden" name="id" value={lead.id} />
            <button className="text-xs text-danger underline">Delete lead (restorable)</button>
          </form>
        )}
      </section>

      <section>
        <ConsultsPanel leadId={lead.id} canWrite={canWrite} />
        <h2 className="mb-2 font-display text-lg">Follow-ups</h2>
        <div className="mb-5 rounded border border-line bg-surface p-3">
          {openFus.length === 0 && <p className="mb-2 text-sm text-muted">No open follow-ups.</p>}
          <ul className="mb-3 flex flex-col gap-2">
            {openFus.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <span className={f.dueAt < new Date(Date.now() - 86_400_000) ? "text-danger" : ""}>{formatCairo(f.dueAt, false)}</span>{" "}
                  <span className="text-xs text-muted">
                    {f.kind}
                    {f.templateId ? " · cadence" : ""}
                  </span>
                  {f.note && (
                    <div dir="auto" className="text-xs text-muted">
                      {f.note}
                    </div>
                  )}
                </div>
                {canWrite && (
                  <>
                    <form action={completeFollowUpAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <button className="rounded border border-line px-2 py-1 text-xs hover:border-gold">Done</button>
                    </form>
                    <form action={rescheduleFollowUpAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="date" name="date" required aria-label="Reschedule to" className="rounded border border-line bg-bg px-1 py-0.5 text-xs" />
                      <button className="rounded border border-line px-2 py-1 text-xs hover:border-gold">Move</button>
                    </form>
                    <form action={cancelFollowUpAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <button className="px-1 text-xs text-muted hover:text-danger" aria-label="Cancel follow-up">
                        ×
                      </button>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <form action={addFollowUpAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={lead.id} />
                <input type="date" name="date" required aria-label="Due date" className={box} />
                <select name="kind" defaultValue="whatsapp" className={box} aria-label="Kind">
                  {["whatsapp", "call", "instagram", "linkedin", "email", "other"].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <input name="note" placeholder="Note" dir="auto" className={`${box} min-w-0 flex-1`} />
                <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Add</button>
              </form>
              <form action={applyCadenceAction} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="leadId" value={lead.id} />
                <select name="templateId" className={box} aria-label="Cadence">
                  {tpls.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="rounded border border-line px-3 py-1.5 text-sm hover:border-gold">Start cadence</button>
                <span className="text-xs text-muted">Stops when they reply or the lead is won or lost.</span>
              </form>
            </div>
          )}
        </div>

        <h2 className="mb-2 font-display text-lg">Timeline</h2>
        {canWrite && (
          <form action={addActivity} className="mb-4 flex flex-col gap-2 rounded border border-line bg-surface p-3">
            <input type="hidden" name="id" value={lead.id} />
            <div className="flex gap-2">
              <select name="type" defaultValue="whatsapp" className={box} aria-label="Type">
                {["whatsapp", "call", "instagram", "linkedin", "email", "note", "consult"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select name="direction" defaultValue="out" className={box} aria-label="Direction">
                <option value="out">out (we sent)</option>
                <option value="in">in (they replied)</option>
                <option value="internal">internal</option>
              </select>
            </div>
            <textarea name="body" rows={2} dir="auto" placeholder="What happened?" className={box} />
            <button className="self-start rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Log activity</button>
          </form>
        )}
        <ol className="flex flex-col gap-2">
          {timeline.map((t, i) => (
            <li key={i} className="rounded border border-line p-2 text-sm">
              <div className="flex justify-between gap-2 text-xs text-muted">
                <span className="capitalize">{t.text}</span>
                <span>
                  {formatCairo(t.at)}
                  {t.by ? ` · ${t.by}` : ""}
                </span>
              </div>
              {t.body && (
                <p dir="auto" className="mt-1 whitespace-pre-wrap">
                  {t.body}
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">
          <Link href="/leads" className="underline">
            ← All leads
          </Link>
        </p>
      </section>
    </div>
  );
}
