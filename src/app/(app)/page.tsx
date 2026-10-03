import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ComposeButton } from "@/components/crm/Composer";
import { DoneMenu, NextStepMenu, SnoozeMenu } from "@/components/crm/FollowUpActions";
import { LiveWait } from "@/components/crm/LiveWait";
import { Avatar, EmptyState, Icon, type IconName } from "@/components/ui";
import { aiOffered } from "@/lib/ai/core";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { TZ, formatCairo } from "@/lib/time";
import { getToday, type TodayFollowUp } from "@/lib/today";
import { runScheduledRules } from "@/lib/workflows";
import { quickLogAction } from "./followups/actions";

export const metadata = { title: "Today" };

const KIND_LABEL: Record<string, string> = { whatsapp: "WhatsApp", call: "Call", instagram: "Instagram", linkedin: "LinkedIn", email: "Email", other: "Other" };

function Section({
  id,
  title,
  icon,
  count,
  shown,
  tone,
  hint,
  children,
  empty,
  emptyIcon,
  action,
}: {
  id: string;
  title: string;
  icon: IconName;
  count: number;
  shown: number;
  tone?: "brand" | "danger";
  hint?: string;
  children: React.ReactNode;
  empty: string;
  emptyIcon?: IconName;
  action?: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`card relative scroll-mt-20 overflow-hidden ${tone === "brand" && count ? "border-brand/40" : ""}`}>
      {tone === "brand" && count > 0 && <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />}
      <div className="card-head">
        <h2 id={`${id}-h`} className="card-title flex items-center gap-2">
          <Icon name={icon} className={tone === "danger" && count ? "text-danger" : "text-accent"} />
          {title}
          <span className={`count ${count ? (tone === "danger" ? "bg-danger/15 text-danger" : "bg-brand/15 text-accent") : ""}`}>{count}</span>
        </h2>
        {action}
      </div>
      {hint && count > 0 && <p className="border-b border-line/60 px-4 py-2 text-xs text-muted">{hint}</p>}
      {count === 0 ? <EmptyState icon={emptyIcon ?? "check"} title={empty} /> : <ul className="divide-y divide-line/70">{children}</ul>}
      {count > shown && (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Showing the first {shown} of {count}. Clear these to see the rest.
        </p>
      )}
    </section>
  );
}

function LogSent({ leadId, label = "Log sent" }: { leadId: number; label?: string }) {
  return (
    <form action={quickLogAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="direction" value="out" />
      <button className="btn btn-secondary btn-sm" title="Log a WhatsApp you already sent">
        <Icon name="check" size={14} /> {label}
      </button>
    </form>
  );
}

function FollowUpItem({ f, canWrite, overdue }: { f: TodayFollowUp; canWrite: boolean; overdue: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm transition-colors hover:bg-raised/40">
      <Avatar name={f.leadName} size={32} />
      <div className="min-w-0 flex-1">
        <Link href={`/leads/${f.leadId}`} dir="auto" className="font-medium hover:text-accent">
          {f.leadName}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className={overdue ? "font-medium text-danger" : ""}>
            {overdue ? "Overdue since " : "Due "}
            {formatCairo(f.dueAt, !overdue)}
          </span>
          <span aria-hidden>·</span>
          <span>{KIND_LABEL[f.kind] ?? f.kind}</span>
          {f.fromCadence && <span className="chip">cadence</span>}
          {f.fromRule && <span className="chip">rule</span>}
        </div>
        {f.note && (
          <div dir="auto" className="mt-1 text-xs text-fg/80">
            {f.note}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {canWrite && <ComposeButton leadId={f.leadId} phone={f.phone} doNotContact={f.doNotContact} />}
        {canWrite && <LogSent leadId={f.leadId} />}
        {canWrite && <DoneMenu id={f.id} leadId={f.leadId} />}
        {canWrite && <SnoozeMenu id={f.id} leadId={f.leadId} />}
      </div>
    </li>
  );
}

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function TodayPage(props: { searchParams: Promise<{ mine?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  // people without the lead list (designers) start in the production studio
  if (!can(user.role, "lead:read")) redirect(can(user.role, "production:read") ? "/production" : "/account");
  const mine = searchParams.mine === "1";
  // time-based rules (overdue, response-time breaches) also run every few minutes in the background;
  // kicking a sweep here keeps them fresh without making the page wait for it
  void runScheduledRules(db).catch(() => 0);
  const t = await getToday(db, { ownerId: mine ? user.id : undefined });
  const canWrite = can(user.role, "lead:write");
  const aiOn = canWrite && (await aiOffered(db, user.role));
  const now = new Date();
  const s = t.settings;
  const todo = t.totals.queue + t.totals.overdue + t.totals.dueToday;

  const tiles: { href: string; label: string; value: number; icon: IconName; tone?: "danger" | "brand"; sub: string }[] = [
    { href: "#queue", label: "Waiting on you", value: t.totals.queue, icon: "hourglass", tone: "brand", sub: `target ${s.slaTargetMin} min` },
    { href: "#overdue", label: "Overdue", value: t.totals.overdue, icon: "alert", tone: "danger", sub: "follow-ups" },
    { href: "#due", label: "Due today", value: t.totals.dueToday, icon: "calendar", sub: "follow-ups" },
    { href: "#consults", label: "Consults today", value: t.consultsToday.length, icon: "phone", sub: `${t.consultsToday.filter((c) => c.held).length} held` },
  ];

  return (
    <>
      <header className="mb-8 flex flex-col gap-4 animate-rise-in md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="min-w-0 flex-1">
          <div className="eyebrow mb-2">
            {new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now)}
          </div>
          <h1 className="page-title">
            Today<span className="hidden font-normal text-muted sm:inline"> · {greeting(now)}, {user.name}</span>
          </h1>
          <p className="mt-1 font-display text-lg text-muted sm:hidden">
            {greeting(now)}, {user.name}
          </p>
          <p className="mt-1.5 text-sm text-muted">
            {todo === 0 ? "You are all caught up." : `${todo} thing${todo === 1 ? "" : "s"} need you today.`}
            {t.totals.noNextStep > 0 && ` ${t.totals.noNextStep} open lead${t.totals.noNextStep === 1 ? " has" : "s have"} no next step.`}
          </p>
        </div>
        <div className="flex self-start rounded-lg border border-line bg-surface p-1 text-sm md:self-auto" role="group" aria-label="Whose leads">
          <Link href="/" aria-current={!mine ? "page" : undefined} className={`rounded-md px-4 py-2 ${!mine ? "bg-raised font-medium" : "text-muted hover:text-fg"}`}>
            Everyone
          </Link>
          <Link href="/?mine=1" aria-current={mine ? "page" : undefined} className={`rounded-md px-4 py-2 ${mine ? "bg-raised font-medium" : "text-muted hover:text-fg"}`}>
            Only mine
          </Link>
        </div>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((k, i) => (
          <a
            key={k.label}
            href={k.href}
            style={{ animationDelay: `${i * 40}ms` }}
            className={`card group relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-lift animate-rise-in ${
              k.value && k.tone === "danger" ? "border-danger/40" : k.value && k.tone === "brand" ? "border-brand/40" : ""
            }`}
          >
            <div className="flex items-center justify-between text-xs font-medium text-muted">
              {k.label}
              <Icon name={k.icon} className={k.value && k.tone === "danger" ? "text-danger" : k.value ? "text-accent" : "text-muted"} />
            </div>
            <div className="num mt-2 font-display text-[32px] font-semibold leading-none">{k.value}</div>
            <div className="mt-1.5 text-xs text-muted">{k.sub}</div>
          </a>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section
            id="queue"
            title="Response queue"
            icon="hourglass"
            tone="brand"
            count={t.totals.queue}
            shown={t.queue.length}
            hint={`Longest waiting first. Amber after ${s.slaAmberMin} min, red after ${s.slaRedMin} min${s.workingHours.enabled ? `, counting ${s.workingHours.start}–${s.workingHours.end} only` : ""}.`}
            empty="Nobody is waiting on a reply."
            emptyIcon="sparkle"
          >
            {t.queue.map((q) => (
              <li key={q.leadId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm transition-colors hover:bg-raised/40">
                <Avatar name={q.fullName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${q.leadId}`} dir="auto" className="font-medium hover:text-accent">
                      {q.fullName}
                    </Link>
                    <LiveWait since={q.since.toISOString()} amber={s.slaAmberMin} red={s.slaRedMin} workingHours={s.workingHours} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {q.reason === "new" ? "New lead, no reply yet" : "They replied, waiting on us"}
                    {q.source ? ` · ${q.source}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {canWrite && <ComposeButton leadId={q.leadId} phone={q.phone} doNotContact={q.doNotContact} label="Reply" />}
                  {canWrite && <LogSent leadId={q.leadId} label="Replied" />}
                </div>
              </li>
            ))}
          </Section>

          <Section id="overdue" title="Overdue follow-ups" icon="alert" tone="danger" count={t.totals.overdue} shown={t.overdue.length} empty="Nothing overdue.">
            {t.overdue.map((f) => (
              <FollowUpItem key={f.id} f={f} canWrite={canWrite} overdue />
            ))}
          </Section>

          <Section id="due" title="Follow-ups due today" icon="calendar" count={t.totals.dueToday} shown={t.dueToday.length} empty="No follow-ups due today.">
            {t.dueToday.map((f) => (
              <FollowUpItem key={f.id} f={f} canWrite={canWrite} overdue={false} />
            ))}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Section id="consults" title="Consults today" icon="phone" count={t.consultsToday.length} shown={t.consultsToday.length} empty="No consults today." emptyIcon="calendar">
            {t.consultsToday.map((c) => {
              const past = c.scheduledAt < now;
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="num w-14 shrink-0 text-center">
                    <div className={`font-display text-lg font-semibold leading-none ${past && !c.held ? "text-warn" : ""}`}>
                      {new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(c.scheduledAt)}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">Cairo</div>
                  </div>
                  <div className="min-w-0 flex-1 border-l border-line pl-3">
                    <Link href={`/leads/${c.leadId}`} dir="auto" className="font-medium hover:text-accent">
                      {c.leadName}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.held ? (
                        <span className="chip chip-ok">held{c.outcome ? ` · ${c.outcome.replace("_", " ")}` : ""}</span>
                      ) : c.outcome === "no_show" ? (
                        <span className="chip chip-danger">no-show</span>
                      ) : past ? (
                        <span className="chip chip-warn">record the result</span>
                      ) : (
                        <span className={c.confirmed ? "chip chip-ok" : "chip chip-warn"}>{c.confirmed ? "confirmed" : "not confirmed"}</span>
                      )}
                    </div>
                  </div>
                  {aiOn && !c.held && !c.outcome && (
                    <Link href={`/leads/${c.leadId}#brief`} className="btn btn-ghost btn-sm" title="Read an AI brief before the call">
                      <Icon name="sparkle" size={14} /> Brief
                    </Link>
                  )}
                  {canWrite && <ComposeButton leadId={c.leadId} phone={c.phone} label="" />}
                </li>
              );
            })}
          </Section>

          <Section
            id="decisions"
            title="Decisions due"
            icon="target"
            count={t.totals.decisionsDue}
            shown={t.decisionsDue.length}
            hint={`Offers whose agreed decision date has come (or ${s.decisionDueDays}+ days with no date).`}
            empty="No offers waiting on a decision."
            emptyIcon="target"
            action={
              <Link href="/leads?view=decision_due" className="text-xs text-muted hover:text-fg">
                View all
              </Link>
            }
          >
            {t.decisionsDue.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Avatar name={l.fullName} size={28} />
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${l.id}`} dir="auto" className="font-medium hover:text-accent">
                    {l.fullName}
                  </Link>
                  <div className="text-xs text-muted">
                    {l.decisionDueAt ? `Decision date ${formatCairo(l.decisionDueAt, false)}` : `Offer sent ${formatCairo(l.since ?? null, false)}, no decision date`}
                  </div>
                </div>
                {canWrite && <ComposeButton leadId={l.id} phone={l.phone} doNotContact={l.doNotContact} label="" />}
              </li>
            ))}
          </Section>

          <Section
            id="next"
            title="No next step"
            icon="flag"
            tone="danger"
            count={t.totals.noNextStep}
            shown={t.noNextStep.length}
            hint="Every open lead needs a dated next step. Give each one a follow-up."
            empty="Every open lead has a next step."
            emptyIcon="flag"
            action={
              <Link href="/leads?view=no_next_step" className="text-xs text-muted hover:text-fg">
                View all
              </Link>
            }
          >
            {t.noNextStep.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${l.id}`} dir="auto" className="font-medium hover:text-accent">
                    {l.fullName}
                  </Link>
                  <div className="text-xs text-muted">{l.stageLabel}</div>
                </div>
                {canWrite && <NextStepMenu leadId={l.id} />}
              </li>
            ))}
          </Section>

          {t.totals.neglected > 0 && (
            <Link href="/leads?view=neglected" className="card flex items-center gap-3 p-4 text-sm transition hover:border-warn/50">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-warn/10 text-warn">
                <Icon name="alert" />
              </span>
              <span className="flex-1">
                <span className="font-medium">{t.totals.neglected} neglected</span>
                <span className="block text-xs text-muted">Open leads with no activity for {s.neglectDays}+ days</span>
              </span>
              <Icon name="chevronRight" className="text-muted" />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
