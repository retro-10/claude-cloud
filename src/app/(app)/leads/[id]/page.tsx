import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, cadenceTemplates, cohorts, consults, followUps, leadForms, leads, ledgerEntries, lostReasons, sources, stageEvents, stages, users } from "@/db/schema";
import { ComposeButton } from "@/components/crm/Composer";
import { DoneMenu, SnoozeMenu } from "@/components/crm/FollowUpActions";
import { LiveWait } from "@/components/crm/LiveWait";
import { StageStepper } from "@/components/crm/StageStepper";
import { ConsultsPanel } from "@/components/ConsultsPanel";
import { CandidateMoney } from "@/components/finance/CandidateMoney";
import { TaskForm, TaskList } from "@/components/tasks/TaskPanel";
import { listTasks } from "@/lib/tasks";
import { FilesPanel } from "@/components/FilesPanel";
import { startRunAction } from "@/app/(app)/team/actions";
import { listRuns, listSops } from "@/lib/operations";
import { listAttachments } from "@/lib/attachments";
import { publicBaseUrl } from "@/lib/public-url";
import { makeReferralCodeAction, setReferrerAction } from "../../growth/referrals/actions";
import { PortalInvite } from "@/components/programme/PortalInvite";
import { portalStatus } from "@/lib/portal";
import { certificatesFor } from "@/lib/graduation";
import { setPortalActiveAction } from "../portal-actions";
import { ProgrammeCard } from "@/components/programme/ProgrammeCard";
import { Flash } from "@/components/Flash";
import { LeadForm } from "@/components/LeadForm";
import { Avatar, Card, EmptyState, Icon, type IconName } from "@/components/ui";
import { getSettings } from "@/lib/app-settings";
import { CONSENT_METHODS, currentConsent } from "@/lib/consent";
import { listCandidates } from "@/lib/finance";
import { CHECKS, evaluate, requiredChecks } from "@/lib/exit-criteria";
import { undoableMerges } from "@/lib/merge";
import { TIER_LABEL } from "@/lib/pricing";
import { listProof, listSessions } from "@/lib/programme";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { healthOf } from "@/lib/views";
import {
  addActivity,
  consentAction,
  deleteLeadAction,
  doNotContactAction,
  restoreLeadAction,
  setTagsAction,
  undoMergeAction,
  updateOfferAction,
} from "../actions";
import { addFollowUpAction, applyCadenceAction, cancelFollowUpAction } from "../../followups/actions";

const KIND_LABEL: Record<string, string> = { whatsapp: "WhatsApp", call: "Call", instagram: "Instagram", linkedin: "LinkedIn", email: "Email", note: "Note", consult: "Consult", other: "Other", reply: "Reply" };
const ICON: Record<string, IconName> = { whatsapp: "chat", call: "phone", instagram: "chat", linkedin: "chat", email: "send", note: "note", consult: "phone", stage: "arrowRight", "follow-up": "calendar" };
const TIERS = [
  ["foundation", "Foundation"],
  ["freelance_ready", "Freelance Ready"],
  ["production_partner", "Production Partner"],
] as const;
const egp = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} EGP`;

export default async function LeadPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) notFound();

  const [stageList, sourceList, ownerList, reasons, acts, events, cons, fus, tpls, cohortRows, candidates, settings, consent, merges] = await Promise.all([
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.id)),
    db.select({ a: activities, by: users.name }).from(activities).leftJoin(users, eq(users.id, activities.byUserId)).where(eq(activities.leadId, id)),
    db.select({ e: stageEvents, by: users.name }).from(stageEvents).leftJoin(users, eq(users.id, stageEvents.byUserId)).where(eq(stageEvents.leadId, id)),
    db.select().from(consults).where(eq(consults.leadId, id)),
    db.select().from(followUps).where(eq(followUps.leadId, id)).orderBy(desc(followUps.dueAt)),
    db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id)),
    db
      .select({ id: cohorts.id, name: cohorts.name, seatCap: cohorts.seatCap, used: sql<number>`(select count(*)::int from enrolments e where e.cohort_id = "cohorts"."id")` })
      .from(cohorts)
      .orderBy(asc(cohorts.id)),
    listCandidates(db, { leadId: id }),
    getSettings(db),
    currentConsent(db, id),
    undoableMerges(db, id),
  ]);
  const payments = candidates.length
    ? await db
        .select()
        .from(ledgerEntries)
        .where(and(inArray(ledgerEntries.enrolmentId, candidates.map((c) => c.enrolmentId)), isNull(ledgerEntries.deletedAt)))
        .orderBy(asc(ledgerEntries.createdAt))
    : [];
  const enrolmentIds = candidates.map((c) => c.enrolmentId);
  const [sessions, proof, leadTasks, files, referrer, referredPeople, [applyForm], base] = await Promise.all([
    listSessions(db, enrolmentIds),
    listProof(db, { enrolmentIds }),
    listTasks(db, { leadId: id, status: "all" }),
    listAttachments(db, { leadId: id }),
    lead.referredById ? db.select({ id: leads.id, fullName: leads.fullName }).from(leads).where(eq(leads.id, lead.referredById)).then((r) => r[0] ?? null) : Promise.resolve(null),
    db.select({ id: leads.id, fullName: leads.fullName }).from(leads).where(and(eq(leads.referredById, id), isNull(leads.deletedAt))),
    db.select({ slug: leadForms.slug }).from(leadForms).where(and(eq(leadForms.active, true), isNull(leadForms.campaignId))).orderBy(asc(leadForms.id)).limit(1),
    publicBaseUrl(),
  ]);
  const [portal, certs, playbooks, leadRuns] = await Promise.all([portalStatus(db, id), certificatesFor(db, id), listSops(db), listRuns(db, { leadId: id })]);
  const openFus = fus.filter((f) => !f.doneAt && !f.cancelledAt).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const stage = stageList.find((s) => s.key === lead.stage);
  const stageLabel = (k: string | null) => stageList.find((s) => s.key === k)?.label ?? k ?? "";
  const lastActivity = acts.reduce<Date>((m, { a }) => (a.at > m ? a.at : m), lead.createdAt);
  const lastStage = events.reduce<Date>((m, { e }) => (e.at > m ? e.at : m), lead.createdAt);
  const health = healthOf({ stageKind: stage?.kind ?? null, lastActivityAt: lastActivity, lastStageAt: lastStage, hasOpenFollowUp: openFus.length > 0 }, settings);

  // What the next stage on the main path needs (P1), shown before anyone tries to move
  const nextStage = stage?.kind === "open" ? stageList.find((s) => s.position > stage.position && (s.kind === "open" || s.kind === "won")) : undefined;
  // facts supplied in the move dialog itself (payment reference, lost reason, next date) are asked there
  const ASKED_AT_MOVE = new Set(["payment_reference", "lost_reason", "next_step"]);
  const nextChecks = nextStage ? (await requiredChecks(db, nextStage.key)).filter((k) => !ASKED_AT_MOVE.has(k)) : [];
  const nextMissing = nextStage ? new Set((await evaluate(db, id, nextChecks)).map((m) => m.key)) : new Set<string>();

  type Item = { at: Date; kind: string; title: string; body?: string | null; by?: string | null; dir?: string };
  const timeline: Item[] = [
    ...acts.map(({ a, by }) => ({
      at: a.at,
      kind: a.type,
      dir: a.direction,
      title: a.type === "note" ? "Note" : `${KIND_LABEL[a.type] ?? a.type} ${a.direction === "in" ? "received" : a.direction === "out" ? "sent" : ""}`.trim(),
      body: a.body,
      by,
    })),
    ...events.map(({ e, by }) => ({
      at: e.at,
      kind: "stage",
      title: e.fromStage ? `${stageLabel(e.fromStage)} → ${stageLabel(e.toStage)}` : `Created as ${stageLabel(e.toStage)}`,
      by,
    })),
    ...cons.map((c) => ({
      at: c.scheduledAt,
      kind: "consult",
      title: `Consult ${c.held ? "held" : "scheduled"}${c.outcome ? ` · ${c.outcome.replace("_", " ")}` : ""}`,
      body: c.notes,
    })),
    ...fus.map((f) => ({
      at: f.dueAt,
      kind: "follow-up",
      title: `Follow-up due${f.doneAt ? " (done)" : f.cancelledAt ? " (cancelled)" : ""}`,
      body: f.note,
    })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());

  const canWrite = can(user.role, "lead:write") && !lead.deletedAt;
  const owner = ownerList.find((o) => o.id === lead.ownerId)?.name;
  const source = sourceList.find((s) => s.id === lead.sourceId)?.label;
  const offerTier = TIERS.find(([k]) => k === lead.offerTier)?.[1];

  return (
    <div className="flex flex-col gap-6">
      <Link href="/leads" className="flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> All leads
      </Link>
      <Flash notice={searchParams.notice} error={searchParams.error} />

      {lead.deletedAt && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <Icon name="trash" />
          {lead.mergedIntoId ? (
            <span>
              This lead was merged into{" "}
              <Link href={`/leads/${lead.mergedIntoId}`} className="font-medium underline">
                another lead
              </Link>
              .
            </span>
          ) : (
            <span>This lead is deleted.</span>
          )}
          {can(user.role, "lead:delete") && !lead.mergedIntoId && (
            <form action={restoreLeadAction}>
              <input type="hidden" name="id" value={lead.id} />
              <button className="btn btn-secondary btn-sm">Restore</button>
            </form>
          )}
        </div>
      )}

      {/* Hero */}
      <section className="card relative overflow-hidden p-5 animate-rise-in">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-4">
          <Avatar name={lead.fullName} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="page-title" dir="auto">
              {lead.fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`chip ${stage?.kind === "won" ? "chip-ok" : stage?.kind === "lost" ? "chip-danger" : "chip-brand"}`}>{stage?.label}</span>
              <span className="chip num">{health.daysInStage}d in stage</span>
              {!lead.firstContactAt && stage?.kind === "open" && (
                <LiveWait since={lead.createdAt.toISOString()} amber={settings.slaAmberMin} red={settings.slaRedMin} workingHours={settings.workingHours} />
              )}
              {health.neglected && <span className="chip chip-warn">neglected · {health.daysSilent}d silent</span>}
              {health.stale && <span className="chip chip-warn">stale</span>}
              {health.noNextStep && <span className="chip chip-danger">no next step</span>}
              {lead.doNotContact && (
                <span className="chip chip-danger">
                  <Icon name="ban" size={11} /> do not contact
                </span>
              )}
              {lead.tags.map((t) => (
                <Link key={t} href={`/leads?tag=${encodeURIComponent(t)}`} className="chip hover:text-fg">
                  #{t}
                </Link>
              ))}
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {lead.phoneWhatsapp && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">WhatsApp</dt>
                  <Icon name="phone" size={14} />
                  <dd className="num text-fg" dir="ltr">
                    {lead.phoneWhatsapp}
                  </dd>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Email</dt>
                  <Icon name="send" size={14} />
                  <dd dir="ltr">{lead.email}</dd>
                </div>
              )}
              {lead.city && (
                <div>
                  <dt className="sr-only">City</dt>
                  <dd dir="auto">{lead.city}</dd>
                </div>
              )}
              {source && (
                <div>
                  <dt className="inline">Source </dt>
                  <dd className="inline text-fg">{source}</dd>
                </div>
              )}
              {lead.attribution && (lead.attribution.utm_source || lead.attribution.utm_medium || lead.attribution.utm_content) && (
                <div>
                  <dt className="inline">Came from </dt>
                  <dd className="inline text-fg" dir="ltr">
                    {[lead.attribution.utm_source, lead.attribution.utm_medium, lead.attribution.utm_content].filter(Boolean).join(" · ")}
                  </dd>
                </div>
              )}
              <div>
                <dt className="inline">Owner </dt>
                <dd className="inline text-fg">{owner ?? "Unassigned"}</dd>
              </div>
            </dl>
          </div>
          <div className="flex items-center gap-2">
            {canWrite && <ComposeButton leadId={lead.id} phone={lead.phoneWhatsapp} doNotContact={lead.doNotContact} size="md" />}
          </div>
        </div>
        <div className="relative mt-5 border-t border-line pt-4">
          <StageStepper
            stages={stageList.map((s) => ({ key: s.key, label: s.label, kind: s.kind }))}
            current={lead.stage}
            lead={{
              id: lead.id,
              fullName: lead.fullName,
              tierInterest: lead.tierInterest,
              hasNextStep: openFus.length > 0,
              offerTier: lead.offerTier,
              offerAmountEgp: lead.offerAmountEgp,
            }}
            lostReasons={reasons}
            cohorts={cohortRows}
            canWrite={canWrite}
            isOwner={user.role === "owner"}
            canOverride={can(user.role, "stage:override")}
          />
        </div>
        <dl className="relative mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[
            ["Created", formatCairo(lead.createdAt)],
            ["First contact", formatCairo(lead.firstContactAt) || "—"],
            ["First reply", formatCairo(lead.firstReplyAt) || "—"],
            ["Last activity", formatCairo(lastActivity)],
          ].map(([k, v]) => (
            <div key={k} className="well px-3 py-2">
              <dt className="text-muted">{k}</dt>
              <dd className="num mt-0.5 text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          {nextStage && nextChecks.length > 0 && (
            <Card title={`Ready for ${nextStage.label}?`} icon="flag" bodyClass="px-4 py-3">
              <ul className="grid gap-2 sm:grid-cols-2">
                {nextChecks.map((k) => {
                  const ok = !nextMissing.has(k);
                  return (
                    <li key={k} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${ok ? "border-ok/60 bg-ok/15 text-ok" : "border-line text-muted"}`}>
                        {ok && <Icon name="check" size={10} />}
                      </span>
                      <span className={ok ? "text-muted line-through decoration-muted/40" : ""}>
                        {CHECKS[k].label}
                        {!ok && <span className="block text-xs text-muted no-underline">{CHECKS[k].fix}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card title="Next steps" icon="calendar" bodyClass="p-0" actions={openFus.length === 0 && stage && ["open", "nurture"].includes(stage.kind) ? <span className="chip chip-danger">none set</span> : undefined}>
            {openFus.length === 0 && <EmptyState icon="flag" title="No open follow-ups">Every open lead needs a dated next step.</EmptyState>}
            <ul className="divide-y divide-line/70">
              {openFus.map((f) => {
                const late = f.dueAt < new Date(Date.now() - 86_400_000);
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`num font-medium ${late ? "text-danger" : ""}`}>{formatCairo(f.dueAt)}</span>
                        <span className="chip">{KIND_LABEL[f.kind] ?? f.kind}</span>
                        {f.templateId && <span className="chip">cadence</span>}
                        {f.ruleId && <span className="chip">rule</span>}
                      </div>
                      {f.note && (
                        <div dir="auto" className="mt-1 text-xs text-muted">
                          {f.note}
                        </div>
                      )}
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1">
                        <DoneMenu id={f.id} leadId={lead.id} />
                        <SnoozeMenu id={f.id} leadId={lead.id} />
                        <form action={cancelFollowUpAction}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="leadId" value={lead.id} />
                          <button className="btn btn-ghost btn-sm w-7 px-0 hover:text-danger" aria-label="Cancel follow-up" title="Cancel">
                            <Icon name="x" size={14} />
                          </button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {canWrite && (
              <div className="flex flex-col gap-3 border-t border-line bg-bg/30 px-4 py-3">
                <form action={addFollowUpAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={lead.id} />
                  <label className="field">
                    Due
                    <input type="date" name="date" required className="input w-auto" />
                  </label>
                  <label className="field">
                    Kind
                    <select name="kind" defaultValue="whatsapp" className="input w-auto">
                      {["whatsapp", "call", "instagram", "linkedin", "email", "other"].map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input name="note" placeholder="What to do" aria-label="Note" dir="auto" className="input min-w-0 flex-1" />
                  <button className="btn btn-primary">
                    <Icon name="plus" size={14} /> Add
                  </button>
                </form>
                <form action={applyCadenceAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <select name="templateId" className="input input-sm w-auto" aria-label="Cadence">
                    {tpls.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-secondary btn-sm">Start cadence</button>
                  <span className="text-xs text-muted">Stops when they reply or the lead is won or lost.</span>
                </form>
              </div>
            )}
          </Card>

          <Card title="Activity" icon="history" bodyClass="p-0">
            {canWrite && (
              <form action={addActivity} className="flex flex-col gap-2 border-b border-line bg-bg/30 px-4 py-3">
                <input type="hidden" name="id" value={lead.id} />
                <div className="flex flex-wrap gap-2">
                  <select name="type" defaultValue="whatsapp" className="input input-sm w-auto" aria-label="Type">
                    {["whatsapp", "call", "instagram", "linkedin", "email", "note", "consult"].map((t) => (
                      <option key={t} value={t}>
                        {KIND_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <select name="direction" defaultValue="out" className="input input-sm w-auto" aria-label="Direction">
                    <option value="out">We sent</option>
                    <option value="in">They replied</option>
                    <option value="internal">Internal</option>
                  </select>
                </div>
                <textarea name="body" rows={2} dir="auto" placeholder="What happened?" aria-label="What happened" className="input" />
                <button className="btn btn-primary self-start">Log activity</button>
              </form>
            )}
            <ol className="relative px-4 py-4">
              <span aria-hidden className="absolute bottom-6 left-[31px] top-6 w-px bg-line" />
              {timeline.map((t, i) => (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  <span
                    className={`relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                      t.dir === "in" ? "border-brand/50 bg-brand/10 text-accent" : t.kind === "stage" ? "border-line bg-raised text-fg" : "border-line bg-surface text-muted"
                    }`}
                  >
                    <Icon name={t.dir === "in" ? "reply" : (ICON[t.kind] ?? "note")} size={14} />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">{t.title}</span>
                      <span className="num text-xs text-muted">
                        {formatCairo(t.at)}
                        {t.by ? ` · ${t.by}` : ""}
                      </span>
                    </div>
                    {t.body && (
                      <p dir="auto" className={`mt-1.5 whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${t.dir === "in" ? "border border-brand/20 bg-brand/5" : "bg-raised/60"}`}>
                        {t.body}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card
            title="Offer"
            icon="target"
            bodyClass="p-4"
            actions={
              canWrite ? (
                <Link href={`/tools/offer?lead=${lead.id}`} className="btn btn-ghost btn-sm">
                  <Icon name="template" size={14} /> Offer builder
                </Link>
              ) : undefined
            }
          >
            {lead.offerAmountEgp || offerTier || lead.decisionDueAt ? (
              <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
                <div className="well px-3 py-2">
                  <div className="text-xs text-muted">Offered</div>
                  <div className="num font-display text-lg font-semibold">{lead.offerAmountEgp ? egp(lead.offerAmountEgp) : "—"}</div>
                  <div className="text-xs text-muted">{offerTier ?? "no tier"}</div>
                </div>
                <div className="well px-3 py-2">
                  <div className="text-xs text-muted">Decision date</div>
                  <div className="num font-display text-lg font-semibold">{lead.decisionDueAt ? formatCairo(lead.decisionDueAt, false) : "—"}</div>
                  <div className="text-xs text-muted">{lead.offerSentAt ? `link sent ${formatCairo(lead.offerSentAt, false)}` : "link not sent"}</div>
                </div>
              </div>
            ) : null}
            <form action={updateOfferAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="id" value={lead.id} />
              <fieldset disabled={!canWrite} className="contents">
                <label className="field">
                  Tier
                  <select name="offerTier" defaultValue={lead.offerTier ?? ""} className="input">
                    <option value="">Not chosen</option>
                    {TIERS.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Price (EGP)
                  <input name="offerAmountEgp" inputMode="numeric" defaultValue={lead.offerAmountEgp ?? ""} className="input num" />
                </label>
                <label className="field col-span-2">
                  Payment link
                  <input name="offerPaymentLink" type="url" dir="ltr" placeholder="https://…" defaultValue={lead.offerPaymentLink ?? ""} className="input" />
                </label>
                <label className="field">
                  Decision date
                  <input name="decisionDueAt" type="date" defaultValue={lead.decisionDueAt ? toCairoLocalInput(lead.decisionDueAt).slice(0, 10) : ""} className="input" />
                </label>
                <label className="flex items-end gap-2 pb-2 text-xs text-muted">
                  <input type="checkbox" name="linkSent" defaultChecked={!!lead.offerSentAt} className="check" /> Link sent
                </label>
                {canWrite && <button className="btn btn-secondary col-span-2">Save offer</button>}
              </fieldset>
            </form>
          </Card>

          <ConsultsPanel leadId={lead.id} canWrite={canWrite} />

          <Card title="Tasks" icon="list" label="Tasks">
            <TaskList rows={leadTasks} back={`/leads/${lead.id}`} canWrite={can(user.role, "task:write")} showLinks={false} empty="No tasks on this lead." />
            {can(user.role, "task:write") && !lead.deletedAt && (
              <div className="mt-3">
                <TaskForm people={ownerList} back={`/leads/${lead.id}`} leadId={lead.id} me={user.id} />
              </div>
            )}
            {leadRuns.length > 0 && (
              <ul className="mt-3 border-t border-line pt-2 text-sm">
                {leadRuns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1">
                    <Link href={`/team/runs/${r.id}`} className="link min-w-0 truncate" dir="auto">
                      {r.title}
                    </Link>
                    <span className="text-xs text-muted">{r.completedAt ? "done" : `${r.doneSteps} of ${r.steps.length}`}</span>
                  </li>
                ))}
              </ul>
            )}
            {can(user.role, "task:write") && !lead.deletedAt && playbooks.length > 0 && (
              <form action={startRunAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="assigneeId" value={user.id} />
                <input type="hidden" name="back" value={`/leads/${lead.id}`} />
                <label className="field min-w-0 flex-1">
                  Run a playbook for them
                  <select name="sopId" required defaultValue="" className="input input-sm">
                    <option value="" disabled>
                      Choose
                    </option>
                    {playbooks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-secondary btn-sm">Start</button>
              </form>
            )}
          </Card>

          {candidates.length > 0 && (
            <Card title="Student portal" icon="user" label="Student portal">
              <p className="mb-3 text-sm">
                {portal.state === "none" && "No portal access yet."}
                {portal.state === "invited" && `Invited; the link works until ${formatCairo(portal.inviteExpiresAt!, false)}.`}
                {portal.state === "expired" && "The invite expired before they set a password."}
                {portal.state === "active" && (portal.lastLoginAt ? `Active; last signed in ${formatCairo(portal.lastLoginAt)}.` : "Active.")}
                {portal.state === "off" && "Access switched off."}
              </p>
              {can(user.role, "programme:write") && !lead.deletedAt && (
                <div className="flex flex-col gap-3">
                  {portal.state !== "off" && (
                    <PortalInvite
                      leadId={lead.id}
                      phone={lead.doNotContact ? null : lead.phoneWhatsapp}
                      firstName={lead.fullName.split(/\s+/)[0]}
                      label={portal.state === "none" ? "Give portal access (invite link)" : portal.state === "active" ? "New password link" : "New invite link"}
                    />
                  )}
                  {portal.state !== "none" && (
                    <form action={setPortalActiveAction}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      {portal.state === "off" && <input type="hidden" name="active" value="on" />}
                      <button className="btn btn-ghost btn-sm">{portal.state === "off" ? "Switch access back on" : "Switch access off"}</button>
                    </form>
                  )}
                </div>
              )}
              {certs.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
                  {certs.map(({ c }) => (
                    <li key={c.id}>
                      <a href={`/certificates/${c.code}`} className="link num">
                        Certificate {c.code}
                      </a>{" "}
                      <span className="text-xs text-muted">{c.revokedAt ? "revoked" : `${c.programme}, ${formatCairo(c.issuedAt, false)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Referrals" icon="user" label="Referrals">
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="inline text-muted">Referred by </dt>
                <dd className="inline">
                  {referrer ? (
                    <Link href={`/leads/${referrer.id}`} className="link" dir="auto">
                      {referrer.fullName}
                    </Link>
                  ) : (
                    "nobody recorded"
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline text-muted">Has referred </dt>
                <dd className="inline">
                  {referredPeople.length === 0
                    ? "nobody yet"
                    : referredPeople.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link href={`/leads/${p.id}`} className="link" dir="auto">
                            {p.fullName}
                          </Link>
                        </span>
                      ))}
                </dd>
              </div>
            </dl>
            {lead.referralCode ? (
              <p className="mt-3 text-xs">
                <span className="text-muted">Their referral link: </span>
                {applyForm ? (
                  <code className="num break-all" dir="ltr">
                    {base}/f/{applyForm.slug}?ref={lead.referralCode}
                  </code>
                ) : (
                  <>
                    code <code className="num">{lead.referralCode}</code> (add <code className="num">?ref={lead.referralCode}</code> to any lead form link; a general form with no campaign is used here once you make one)
                  </>
                )}
              </p>
            ) : (
              can(user.role, "growth:write") &&
              !lead.deletedAt && (
                <form action={makeReferralCodeAction} className="mt-3">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <button className="btn btn-secondary btn-sm">Make referral link</button>
                </form>
              )
            )}
            {canWrite && (
              <form action={setReferrerAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <label className="field min-w-0 flex-1">
                  Referred by (their WhatsApp number; empty clears it)
                  <input name="phone" type="tel" dir="ltr" className="input input-sm" />
                </label>
                <button className="btn btn-ghost btn-sm">Save</button>
              </form>
            )}
          </Card>

          <Card title={`Files (${files.length})`} icon="layers" label="Files">
            <FilesPanel rows={files} back={`/leads/${lead.id}`} leadId={lead.id} canWrite={can(user.role, "file:write") && !lead.deletedAt} me={user.id} isOwner={can(user.role, "settings:write")} />
          </Card>

          {can(user.role, "finance:read") && candidates.map((c) => (
            <Card key={c.enrolmentId} title={`${c.cohort} · ${TIER_LABEL[c.tier] ?? c.tier}`} icon="cohorts" label="Payments">
              <div id="money" className="scroll-mt-24" />
              <CandidateMoney
                c={c}
                payments={payments.filter((p) => p.enrolmentId === c.enrolmentId)}
                canWrite={can(user.role, "payment:write")}
                back={`/leads/${lead.id}`}
              />
            </Card>
          ))}

          {candidates.map((c) => (
            <Card key={`p${c.enrolmentId}`} title={`Programme · ${c.cohort}`} icon="target" label="Programme">
              <div id="programme" className="scroll-mt-24" />
              <ProgrammeCard
                c={c}
                sessions={sessions.filter((x) => x.enrolmentId === c.enrolmentId)}
                proof={proof.filter((x) => x.p.enrolmentId === c.enrolmentId).map((x) => x.p)}
                canWrite={canWrite}
                back={`/leads/${lead.id}`}
              />
            </Card>
          ))}

          <Card title="Details" icon="user">
            <LeadForm lead={lead} sources={sourceList} owners={ownerList} readOnly={!canWrite} />
          </Card>

          <Card title="Contact permission" icon="shield" bodyClass="p-4">
            <p className="text-sm">
              {consent ? (
                <>
                  <span className={consent.granted ? "text-ok" : "text-danger"}>{consent.granted ? "Agreed to WhatsApp contact" : "Refused contact"}</span>
                  <span className="block text-xs text-muted">
                    {CONSENT_METHODS[consent.method as keyof typeof CONSENT_METHODS] ?? consent.method} · {formatCairo(consent.at)}
                  </span>
                </>
              ) : (
                <span className="text-muted">No consent recorded yet.</span>
              )}
            </p>
            {canWrite && (
              <div className="mt-3 flex flex-col gap-2">
                <form action={consentAction} className="flex gap-2">
                  <input type="hidden" name="id" value={lead.id} />
                  <select name="method" className="input input-sm flex-1" aria-label="How they agreed">
                    {Object.entries(CONSENT_METHODS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-secondary btn-sm">Record</button>
                </form>
                <form action={doNotContactAction}>
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="value" value={lead.doNotContact ? "0" : "1"} />
                  <button className={`btn btn-sm w-full ${lead.doNotContact ? "btn-secondary" : "btn-danger"}`}>
                    <Icon name="ban" size={13} /> {lead.doNotContact ? "Allow contact again" : "Mark do not contact"}
                  </button>
                </form>
              </div>
            )}
          </Card>

          <Card title="Tags" icon="layers" bodyClass="p-4">
            <form action={setTagsAction} className="flex gap-2">
              <input type="hidden" name="id" value={lead.id} />
              <input name="tags" defaultValue={lead.tags.join(", ")} placeholder="vip, referral, exocad" aria-label="Tags, separated by commas" disabled={!canWrite} className="input input-sm flex-1" />
              {canWrite && <button className="btn btn-secondary btn-sm">Save</button>}
            </form>
          </Card>

          {canWrite && (
            <Card title="Housekeeping" icon="merge" bodyClass="flex flex-col gap-2 p-4">
              <Link href={`/leads/merge?a=${lead.id}`} className="btn btn-secondary btn-sm">
                <Icon name="merge" size={13} /> Merge with a duplicate…
              </Link>
              {merges.map((m) => (
                <form key={m.id} action={undoMergeAction} className="flex items-center justify-between gap-2 text-xs text-muted">
                  <input type="hidden" name="mergeId" value={m.id} />
                  <input type="hidden" name="leadId" value={lead.id} />
                  <span>Merged lead #{m.loserId} on {formatCairo(m.mergedAt, false)}</span>
                  <button className="btn btn-ghost btn-sm">Undo</button>
                </form>
              ))}
              {can(user.role, "lead:delete") && (
                <form action={deleteLeadAction}>
                  <input type="hidden" name="id" value={lead.id} />
                  <button className="btn btn-ghost btn-sm w-full text-danger hover:bg-danger/10">
                    <Icon name="trash" size={13} /> Delete lead (restorable)
                  </button>
                </form>
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
