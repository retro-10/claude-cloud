import Link from "next/link";
import { db } from "@/db";
import { SpeedBadge } from "@/components/SpeedBadge";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { whatsappUrl } from "@/lib/phone";
import { cairoYmd, formatCairo } from "@/lib/time";
import { getToday, type TodayFollowUp } from "@/lib/today";
import { completeFollowUpAction, quickLogAction, rescheduleFollowUpAction } from "./followups/actions";

const btn = "rounded border border-line px-2 py-1 text-xs hover:border-gold";

function Wa({ phone }: { phone: string | null }) {
  const href = whatsappUrl(phone);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="rounded bg-gold px-2 py-1 text-xs font-medium text-ink">
      WhatsApp
    </a>
  );
}

function Section({ title, count, shown, children, empty }: { title: string; count: number; shown: number; children: React.ReactNode; empty: string }) {
  return (
    <section className="rounded border border-line">
      <h2 className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 text-sm font-medium">
        {title}
        <span className={`rounded px-1.5 text-xs ${count ? "bg-gold/20 text-accent" : "bg-bg text-muted"}`}>{count}</span>
      </h2>
      {count === 0 ? <p className="px-3 py-4 text-sm text-muted">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>}
      {count > shown && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Showing the first {shown} of {count}. Clear these to see the rest.
        </p>
      )}
    </section>
  );
}

function FollowUpItem({ f, canWrite, overdue }: { f: TodayFollowUp; canWrite: boolean; overdue: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <Link href={`/leads/${f.leadId}`} dir="auto" className="font-medium hover:text-accent">
          {f.leadName}
        </Link>
        <div className={`text-xs ${overdue ? "text-danger" : "text-muted"}`}>
          {overdue ? "Overdue since " : "Due "}
          {formatCairo(f.dueAt, !overdue)} · {f.kind}
          {f.fromCadence ? " · cadence" : ""}
        </div>
        {f.note && (
          <div dir="auto" className="mt-0.5 text-xs text-muted">
            {f.note}
          </div>
        )}
      </div>
      <Wa phone={f.phone} />
      {canWrite && (
        <>
          <form action={quickLogAction}>
            <input type="hidden" name="leadId" value={f.leadId} />
            <input type="hidden" name="direction" value="out" />
            <button className={btn} title="Log a WhatsApp you sent">
              Sent
            </button>
          </form>
          <form action={completeFollowUpAction}>
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="leadId" value={f.leadId} />
            <button className={btn}>Done</button>
          </form>
          <form action={rescheduleFollowUpAction} className="flex items-center gap-1">
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="leadId" value={f.leadId} />
            <input type="date" name="date" required aria-label="Reschedule to" className="rounded border border-line bg-bg px-1 py-0.5 text-xs" />
            <button className={btn}>Move</button>
          </form>
        </>
      )}
    </li>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: { mine?: string } }) {
  const user = await requireUser();
  const mine = searchParams.mine === "1";
  const t = await getToday(db, { ownerId: mine ? user.id : undefined });
  const canWrite = can(user.role, "lead:write");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl">Today</h1>
        <span className="text-sm text-muted">{cairoYmd(new Date())}</span>
        <Link href={mine ? "/" : "/?mine=1"} className="ml-auto text-xs text-muted underline">
          {mine ? "Show everyone's" : "Show only mine"}
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Uncontacted new leads" count={t.totals.uncontacted} shown={t.uncontacted.length} empty="Everyone has had a first message.">
          {t.uncontacted.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${l.id}`} dir="auto" className="font-medium hover:text-accent">
                  {l.fullName}
                </Link>{" "}
                <SpeedBadge createdAt={l.createdAt} firstContactAt={l.firstContactAt} />
              </div>
              <Wa phone={l.phone} />
              {canWrite && (
                <form action={quickLogAction}>
                  <input type="hidden" name="leadId" value={l.id} />
                  <input type="hidden" name="direction" value="out" />
                  <button className={btn} title="Log the first WhatsApp you sent">
                    Sent
                  </button>
                </form>
              )}
            </li>
          ))}
        </Section>

        <Section title="Overdue follow-ups" count={t.totals.overdue} shown={t.overdue.length} empty="Nothing overdue.">
          {t.overdue.map((f) => (
            <FollowUpItem key={f.id} f={f} canWrite={canWrite} overdue />
          ))}
        </Section>

        <Section title="Follow-ups due today" count={t.totals.dueToday} shown={t.dueToday.length} empty="No follow-ups due today.">
          {t.dueToday.map((f) => (
            <FollowUpItem key={f.id} f={f} canWrite={canWrite} overdue={false} />
          ))}
        </Section>

        <Section title="Consults today" count={t.consultsToday.length} shown={t.consultsToday.length} empty="No consults today.">
          {t.consultsToday.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${c.leadId}`} dir="auto" className="font-medium hover:text-accent">
                  {c.leadName}
                </Link>
                <div className="text-xs text-muted">
                  {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(c.scheduledAt)}
                  {c.held ? " · held" : c.outcome ? ` · ${c.outcome.replace("_", " ")}` : ""}
                </div>
              </div>
              <Wa phone={c.phone} />
            </li>
          ))}
        </Section>

        <Section title="Decisions due (offer sent 3+ days)" count={t.totals.decisionsDue} shown={t.decisionsDue.length} empty="No offers waiting on a decision.">
          {t.decisionsDue.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${l.id}`} dir="auto" className="font-medium hover:text-accent">
                  {l.fullName}
                </Link>
                <div className="text-xs text-muted">Offer sent {l.daysInStage} days ago</div>
              </div>
              <Wa phone={l.phone} />
              {canWrite && (
                <form action={quickLogAction}>
                  <input type="hidden" name="leadId" value={l.id} />
                  <input type="hidden" name="direction" value="out" />
                  <button className={btn}>Sent</button>
                </form>
              )}
            </li>
          ))}
        </Section>
      </div>
    </>
  );
}
