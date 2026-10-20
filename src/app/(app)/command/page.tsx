import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { TaskList } from "@/components/tasks/TaskPanel";
import {
  Card,
  EmptyState,
  Icon,
  PageHeader,
  type IconName,
} from "@/components/ui";
import {
  PULSE,
  alerts,
  getReview,
  isWeek,
  listReviews,
  pulse,
  weekNumbers,
  weekStartOf,
  type Alert,
} from "@/lib/command";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { listTasks } from "@/lib/tasks";
import { progressFor, quarterOf, type TargetProgress } from "@/lib/targets";
import { addDaysYmd } from "@/lib/time";
import { saveReviewAction } from "./actions";
import { DraftPanel } from "@/components/ai/DraftPanel";
import { aiOffered } from "@/lib/ai/core";
import { draftWeeklyAction } from "@/app/(app)/ask/drafts";

export const metadata = { title: "Command centre" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const value = (n: number, money: boolean) => (money ? `${fmt(n)} EGP` : fmt(n));

const SEVERITY: Record<
  Alert["severity"],
  { cls: string; icon: IconName; label: string }
> = {
  danger: { cls: "text-danger", icon: "alert", label: "Urgent" },
  warn: { cls: "text-warn", icon: "flag", label: "Needs attention" },
  info: { cls: "text-muted", icon: "eye", label: "Worth a look" },
};
const STATUS: Record<
  TargetProgress["status"],
  { label: string; chip: string; bar: string }
> = {
  done: { label: "Reached", chip: "chip chip-ok", bar: "bg-ok" },
  on_track: { label: "On track", chip: "chip chip-ok", bar: "bg-brand" },
  at_risk: { label: "At risk", chip: "chip chip-warn", bar: "bg-warn" },
  behind: { label: "Behind", chip: "chip chip-danger", bar: "bg-danger" },
  ended_short: { label: "Missed", chip: "chip chip-danger", bar: "bg-danger" },
  no_target: { label: "No target", chip: "chip", bar: "bg-line" },
};

function Delta({ now, before }: { now: number; before: number }) {
  if (now === before)
    return <span className="text-muted">same as the 7 days before</span>;
  const up = now > before;
  const pct = before
    ? Math.round((Math.abs(now - before) / before) * 100)
    : null;
  return (
    <span className={up ? "text-ok" : "text-danger"}>
      {up ? "▲" : "▼"} {pct !== null ? `${pct}%` : `from ${fmt(before)}`}{" "}
      <span className="text-muted">vs the 7 days before</span>
    </span>
  );
}

// OrlaDent OS, Phase 1: the screen everyone opens first. This week's pulse, what needs a person, the quarter's
// targets, my tasks, and the owners' weekly review.
export default async function CommandCentre(props: {
  searchParams: Promise<{ week?: string; notice?: string; error?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const now = new Date();
  const money = can(user.role, "finance:read");
  const owner = can(user.role, "settings:write");
  const ai =
    owner && can(user.role, "ops:manage") && (await aiOffered(db, user.role));
  const thisWeek = weekStartOf(now);
  const week = isWeek(sp.week) ? sp.week : thisWeek;

  const [p, inbox, quarter, myTasks, review, numbers, history] =
    await Promise.all([
      pulse(db, now),
      alerts(db, user.role, now),
      progressFor(db, quarterOf(now), now),
      listTasks(db, { assigneeId: user.id, due: "week" }, now, 6),
      getReview(db, week),
      weekNumbers(db, week),
      listReviews(db, 8),
    ]);
  const pulseItems = PULSE.filter((k) => !k.money || money);
  const targetRows = quarter.rows.filter((r) => !r.money || money);

  return (
    <>
      <PageHeader
        eyebrow="OrlaDent OS"
        title="Command centre"
        subtitle="The last 7 days, what needs a person now, and where the quarter stands. Open it first every morning."
        actions={
          <Link href="/tasks" className="btn btn-secondary btn-sm">
            <Icon name="list" size={14} /> All tasks
          </Link>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />

      <section
        aria-label="Pulse, last 7 days"
        className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6"
      >
        {pulseItems.map((k) => (
          <div key={k.key} className="card p-4">
            <div className="text-xs font-medium text-muted">{k.label}</div>
            <div className="num mt-2 font-display text-[26px] font-semibold leading-none tracking-tight">
              {value(p[k.key].now, k.money)}
            </div>
            <div className="mt-2 text-xs">
              <Delta now={p[k.key].now} before={p[k.key].before} />
            </div>
          </div>
        ))}
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card
          title={`Needs a person (${inbox.length})`}
          icon="inbox"
          bodyClass="p-0"
        >
          {inbox.length === 0 ? (
            <EmptyState
              icon="check"
              title="Nothing needs a person right now."
            />
          ) : (
            <ul className="divide-y divide-line">
              {inbox.map((a) => {
                const s = SEVERITY[a.severity];
                return (
                  <li key={a.key}>
                    <Link
                      href={a.href}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-raised/60"
                    >
                      <Icon
                        name={s.icon}
                        className={`mt-0.5 ${s.cls}`}
                        title={s.label}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {a.title}
                        </span>
                        <span className="block text-xs text-muted">
                          {a.detail}
                        </span>
                      </span>
                      <Icon name="chevronRight" className="mt-0.5 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title={`Targets ${quarter.period}`}
          icon="target"
          actions={
            owner ? (
              <Link href="/settings/targets" className="btn btn-ghost btn-sm">
                Set targets
              </Link>
            ) : undefined
          }
        >
          <div id="targets" className="scroll-mt-24" />
          <p className="mb-3 text-xs text-muted">
            {Math.round(quarter.elapsed * 100)}% of the quarter has gone.
          </p>
          {targetRows.every((r) => r.target === null) ? (
            <EmptyState icon="target" title="No targets for this quarter yet.">
              {owner
                ? "Set them in Settings > Targets."
                : "The owners set them in Settings."}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-4">
              {targetRows
                .filter((r) => r.target !== null)
                .map((r) => {
                  const st = STATUS[r.status];
                  const pct = Math.min(100, r.pct ?? 0);
                  return (
                    <li key={r.metric}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{r.label}</span>
                        <span className={st.chip}>{st.label}</span>
                      </div>
                      <div
                        className="relative h-2 overflow-hidden rounded-full bg-raised"
                        role="progressbar"
                        aria-label={`${r.label}: ${r.pct}% of target`}
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={`h-full rounded-full ${st.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-muted">
                        <span className="num">
                          {value(r.actual, r.unit === "egp")} of{" "}
                          {value(r.target!, r.unit === "egp")}
                        </span>
                        <span className="num">
                          about {value(r.expected!, r.unit === "egp")} by now
                        </span>
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Card
          title="My tasks this week"
          icon="list"
          actions={
            <Link href="/tasks" className="btn btn-ghost btn-sm">
              Open Tasks
            </Link>
          }
        >
          <TaskList
            rows={myTasks}
            back="/command"
            canWrite={can(user.role, "task:write")}
            empty="Nothing due for you this week."
          />
        </Card>

        <Card
          title={`Weekly review · week of ${week}`}
          icon="history"
          label="Weekly review"
        >
          <div id="review" className="scroll-mt-24" />
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={`/command?week=${addDaysYmd(week, -7)}#review`}
              className="btn btn-ghost btn-sm"
            >
              <Icon name="chevronLeft" size={14} /> Previous week
            </Link>
            {week !== thisWeek && (
              <Link
                href={`/command?week=${addDaysYmd(week, 7)}#review`}
                className="btn btn-ghost btn-sm"
              >
                Next week <Icon name="chevronRight" size={14} />
              </Link>
            )}
          </div>
          <dl className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 xl:grid-cols-6">
            {pulseItems.map((k) => (
              <div key={k.key} className="well px-3 py-2">
                <dt className="text-muted">{k.label}</dt>
                <dd className="num mt-0.5 font-semibold">
                  {value(
                    (review?.snapshot?.[k.key] as number | undefined) ??
                      numbers[k.key],
                    k.money,
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {owner ? (
            <>
              {ai && (
                <div className="mb-5 rounded-xl border border-line p-4">
                  <DraftPanel
                    action={draftWeeklyAction.bind(null, week)}
                    button="Draft this week's review"
                    fillForm="weekly-review"
                    rows={10}
                  />
                </div>
              )}
              <form
                id="weekly-review"
                action={saveReviewAction}
                className="grid gap-3"
              >
                <input type="hidden" name="week" value={week} />
                <label className="field">
                  Wins
                  <textarea
                    name="wins"
                    rows={2}
                    defaultValue={review?.wins ?? ""}
                    className="input"
                    dir="auto"
                  />
                </label>
                <label className="field">
                  Misses, and why
                  <textarea
                    name="misses"
                    rows={2}
                    defaultValue={review?.misses ?? ""}
                    className="input"
                    dir="auto"
                  />
                </label>
                <label className="field">
                  Decisions (who does what by when)
                  <textarea
                    name="decisions"
                    rows={2}
                    defaultValue={review?.decisions ?? ""}
                    className="input"
                    dir="auto"
                  />
                </label>
                <label className="field">
                  Notes
                  <textarea
                    name="notes"
                    rows={2}
                    defaultValue={review?.notes ?? ""}
                    className="input"
                    dir="auto"
                  />
                </label>
                <div>
                  <button className="btn btn-primary btn-sm">
                    Save review
                  </button>
                  {review && (
                    <span className="ml-3 text-xs text-muted">
                      Saved {review.updatedAt.toISOString().slice(0, 10)}
                    </span>
                  )}
                </div>
              </form>
            </>
          ) : review ? (
            <div className="grid gap-3 text-sm">
              {(["wins", "misses", "decisions", "notes"] as const).map((k) =>
                review[k] ? (
                  <div key={k}>
                    <div className="eyebrow mb-1">{k}</div>
                    <p className="whitespace-pre-line" dir="auto">
                      {review[k]}
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No review written for this week yet.
            </p>
          )}
          {history.length > 0 && (
            <div className="mt-4 border-t border-line pt-3 text-xs">
              <span className="text-muted">Past reviews: </span>
              {history.map((h, i) => (
                <span key={h.id}>
                  {i > 0 && " · "}
                  <Link
                    href={`/command?week=${h.weekStart}#review`}
                    className="link"
                  >
                    {h.weekStart}
                  </Link>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
