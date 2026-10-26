import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { LiveDuration } from "@/components/calendar/Clock";
import { colorVar } from "@/components/hq/bits";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { ScrollX } from "@/components/ui/ScrollX";
import {
  EVENT_KINDS,
  daysRange,
  effectiveEnd,
  getEvent,
  hours,
  kindOf,
  listEntries,
  listEvents,
  mondayOf,
  onDay,
  presence,
  workedByDay,
  type CalEvent,
  type Presence,
} from "@/lib/calendar";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { addDaysYmd, cairoYmd, formatCairo, toCairoLocalInput, TZ } from "@/lib/time";
import { cancelEventAction, clockInAction, clockOutAction, deleteHoursAction, saveHoursAction, saveEventAction } from "./actions";

export const metadata = { title: "Team calendar" };

type Search = { tab?: string; week?: string; edit?: string; entry?: string; notice?: string; error?: string };

const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

function StateChip({ p }: { p: Presence }) {
  if (p.state === "away" && p.current)
    return <span className="chip chip-danger">Away · {p.current.allDay ? `back ${dayLabel(cairoYmd(p.current.endsAt))}` : `until ${hhmm(p.current.endsAt)}`}</span>;
  if (p.state === "busy" && p.current)
    return (
      <span className="chip chip-warn">
        {kindOf(p.current.kind).label} until {p.current.allDay ? "end of day" : hhmm(p.current.endsAt)}
      </span>
    );
  if (p.state === "working" && p.since)
    return (
      <span className="chip chip-ok">
        Working · <LiveDuration since={p.since.toISOString()} />
      </span>
    );
  return <span className="chip">Not working</span>;
}

function EventChip({ e, ymd, href }: { e: CalEvent; ymd: string; href?: string }) {
  const k = kindOf(e.kind);
  const when = e.allDay ? "All day" : `${cairoYmd(e.startsAt) === ymd ? hhmm(e.startsAt) : "…"}–${cairoYmd(e.endsAt) === ymd ? hhmm(e.endsAt) : "…"}`;
  const body = (
    <span
      className="flex flex-col rounded-md border border-line bg-surface px-1.5 py-1 text-[12px] leading-tight"
      style={{ borderLeft: `3px solid ${colorVar(k.color)}` }}
      title={`${k.label}: ${e.title}${e.note ? `\n${e.note}` : ""}`}
    >
      <span className="text-[11px] tabular-nums text-muted">{when}</span>
      <span className="truncate font-medium">{e.title}</span>
    </span>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function CalendarPage(props: { searchParams: Promise<Search> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("calendar:write");
  const now = new Date();
  const today = cairoYmd(now);
  const tab = sp.tab === "mine" ? "mine" : "team";
  const monday = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i));
  const { from, to } = daysRange(monday, 7);
  const isManager = can(user.role, "users:manage");

  const [people, worked, events, mine, team] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    workedByDay(db, monday, 7, now),
    listEvents(db, from, to),
    listEntries(db, user.id, from, to),
    presence(db, now),
  ]);
  const found = sp.edit && /^\d+$/.test(sp.edit) ? await getEvent(db, Number(sp.edit)) : null;
  const editing = found && (found.userId === user.id || isManager) ? found : undefined;
  const entry = sp.entry && /^\d+$/.test(sp.entry) ? mine.find((e) => e.id === Number(sp.entry)) : undefined;
  const me = team.find((p) => p.id === user.id);
  const base = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const v = { tab: tab === "mine" ? "mine" : undefined, week: monday === mondayOf(today) ? undefined : monday, ...o };
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val);
    const s = p.toString();
    return `/calendar${s ? `?${s}` : ""}`;
  };
  const back = base({});
  const myWeek = days.reduce((a, d) => a + (worked.get(user.id)?.get(d) ?? 0), 0);

  const weekNav = (
    <div className="flex items-center gap-1">
      <Link href={base({ week: addDaysYmd(monday, -7) })} className="btn btn-ghost btn-sm btn-icon" aria-label="Previous week">
        <Icon name="chevronLeft" />
      </Link>
      <Link href={base({ week: undefined })} className="btn btn-secondary btn-sm">
        This week
      </Link>
      <Link href={base({ week: addDaysYmd(monday, 7) })} className="btn btn-ghost btn-sm btn-icon" aria-label="Next week">
        <Icon name="chevronRight" />
      </Link>
    </div>
  );

  const eventForm = (
    <Card title={editing ? "Edit event" : "Add to my calendar"} icon="calendar">
      <form action={saveEventAction} className="flex flex-col gap-4">
        <input type="hidden" name="back" value={editing ? base({}) : back} />
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <label className="field">
          What
          <input name="title" required maxLength={120} defaultValue={editing?.title} placeholder="e.g. Clinic visit, Dentist, Filming day" className="input input-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Kind
            <select name="kind" defaultValue={editing?.kind ?? "meeting"} className="input input-sm">
              {EVENT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {isManager ? (
            <label className="field">
              Whose calendar
              <select name="userId" defaultValue={editing?.userId ?? user.id} className="input input-sm">
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === user.id ? `${p.name} (me)` : p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="userId" value={user.id} />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Starts
            <input type="datetime-local" name="start" required defaultValue={editing ? toCairoLocalInput(editing.startsAt) : `${today}T10:00`} className="input input-sm" />
          </label>
          <label className="field">
            Ends
            <input type="datetime-local" name="end" defaultValue={editing ? toCairoLocalInput(editing.allDay ? new Date(editing.endsAt.getTime() - 60_000) : editing.endsAt) : `${today}T11:00`} className="input input-sm" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="allDay" defaultChecked={editing?.allDay} className="check" /> All day (uses the dates only, from the start day to the end day)
        </label>
        <label className="field">
          Note (optional)
          <input name="note" maxLength={500} defaultValue={editing?.note ?? ""} className="input input-sm" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          {editing && (
            <Link href={base({})} className="btn btn-ghost btn-sm">
              Cancel editing
            </Link>
          )}
          <button className="btn btn-primary btn-sm">{editing ? "Save event" : "Add event"}</button>
        </div>
      </form>
      {editing && (
        <form action={cancelEventAction} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="id" value={editing.id} />
          <input type="hidden" name="back" value={base({})} />
          <ConfirmButton className="btn btn-danger btn-sm" message={`Remove “${editing.title}” from the calendar?`}>
            <Icon name="trash" size={14} /> Remove this event
          </ConfirmButton>
        </form>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Team calendar"
        subtitle="Who is working now, the hours each person logged, and everyone's plans, so you know when people are free."
        actions={weekNav}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs
        label="Calendar"
        current={tab === "mine" ? "/calendar?tab=mine" : "/calendar"}
        items={[
          { href: "/calendar", label: "Team" },
          { href: "/calendar?tab=mine", label: "My time" },
        ]}
      />

      {tab === "team" ? (
        <div className="flex flex-col gap-6">
          <section aria-label="Right now">
            <h2 className="eyebrow mb-3">Right now</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {team.map((p) => (
                <div key={p.id} className={`card flex items-start gap-3 p-4 ${p.state === "working" ? "border-ok/40" : ""}`}>
                  <span aria-hidden className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-brand/40 bg-raised text-xs font-semibold text-accent">
                    {initials(p.name)}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
                        p.state === "working" ? "bg-ok" : p.state === "busy" ? "bg-warn" : p.state === "away" ? "bg-danger" : "bg-faint"
                      }`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {p.name}
                      {p.id === user.id && <span className="font-normal text-muted"> (you)</span>}
                    </div>
                    <div className="mt-1">
                      <StateChip p={p} />
                    </div>
                    <div className="mt-1.5 text-xs text-muted">
                      {p.todayMinutes > 0 ? `${hours(p.todayMinutes)} today` : "No hours today"}
                      {p.next && ` · next: ${p.next.allDay ? "" : `${hhmm(p.next.startsAt)} `}${p.next.title}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <Card
            title={`Week of ${dayLabel(monday)}`}
            icon="calendar"
            bodyClass="p-0"
            actions={
              <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
                {EVENT_KINDS.map((k) => (
                  <span key={k.key} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: colorVar(k.color) }} />
                    {k.label}
                  </span>
                ))}
              </span>
            }
          >
            <ScrollX label="Team week">
              <table className="table min-w-[980px] table-fixed">
                <thead>
                  <tr>
                    <th scope="col" className="w-40">
                      Person
                    </th>
                    {days.map((d) => (
                      <th key={d} scope="col" className={d === today ? "text-accent" : ""}>
                        {dayLabel(d)}
                      </th>
                    ))}
                    <th scope="col" className="w-24 text-right">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const w = worked.get(p.id);
                    const total = days.reduce((a, d) => a + (w?.get(d) ?? 0), 0);
                    return (
                      <tr key={p.id} className="align-top">
                        <th scope="row" className="font-medium">
                          <span className="block truncate">{p.name}</span>
                        </th>
                        {days.map((d) => {
                          const evs = events.filter((e) => e.userId === p.id && onDay(e, d));
                          const mins = w?.get(d) ?? 0;
                          return (
                            <td key={d} className={`!px-1.5 !py-2 ${d === today ? "bg-brand/5" : ""}`}>
                              <div className="flex min-h-[44px] flex-col gap-1">
                                {evs.map((e) => (
                                  <EventChip key={e.id} e={e} ymd={d} href={e.userId === user.id || isManager ? base({ edit: String(e.id) }) : undefined} />
                                ))}
                                {mins > 0 && (
                                  <span className="mt-auto inline-flex w-fit items-center gap-1 rounded bg-ok/10 px-1.5 py-0.5 text-[11px] font-medium text-ok">
                                    <Icon name="clock" size={11} />
                                    {hours(mins)}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="text-right text-sm font-semibold tabular-nums">{total > 0 ? hours(total) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollX>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {eventForm}
            <Card title="Coming up" icon="history" bodyClass="p-0">
              {(() => {
                const upcoming = events.filter((e) => e.endsAt > now).slice(0, 12);
                return upcoming.length ? (
                  <ul className="divide-y divide-line/70">
                    {upcoming.map((e) => (
                      <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                        <span aria-hidden className="h-8 w-1 shrink-0 rounded-full" style={{ background: colorVar(kindOf(e.kind).color) }} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {e.person}: {e.title}
                          </div>
                          <div className="text-xs text-muted">
                            {kindOf(e.kind).label} · {e.allDay ? `${dayLabel(cairoYmd(e.startsAt))}${cairoYmd(new Date(e.endsAt.getTime() - 1)) !== cairoYmd(e.startsAt) ? ` – ${dayLabel(cairoYmd(new Date(e.endsAt.getTime() - 1)))}` : ""}, all day` : `${dayLabel(cairoYmd(e.startsAt))}, ${hhmm(e.startsAt)}–${hhmm(e.endsAt)}`}
                          </div>
                        </div>
                        {(e.userId === user.id || isManager) && (
                          <Link href={base({ edit: String(e.id) })} className="btn btn-ghost btn-sm" aria-label={`Edit ${e.title}`}>
                            <Icon name="edit" size={14} />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon="calendar" title="Nothing planned this week">
                    Add meetings, focus time and days off so the team knows when you are free.
                  </EmptyState>
                );
              })()}
            </Card>
          </div>

          {can(user.role, "finance:read") && (
            <Card title="Hours for payroll" icon="download">
              <form action="/calendar/export" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="field">
                  Month
                  <input type="month" name="month" required defaultValue={today.slice(0, 7)} className="input input-sm sm:w-48" />
                </label>
                <button name="kind" value="summary" className="btn btn-secondary btn-sm">
                  <Icon name="download" size={14} /> Total per person (CSV)
                </button>
                <button name="kind" value="detail" className="btn btn-ghost btn-sm">
                  <Icon name="download" size={14} /> Every stretch (CSV)
                </button>
              </form>
              <p className="mt-3 text-xs text-muted">Hours are split by Cairo calendar month. Clocks someone forgot to stop were stopped at midnight and are marked, so you can check them.</p>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card title="My clock" icon="clock">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  {me?.since ? (
                    <>
                      <div className="text-sm text-muted">Working since {hhmm(me.since)}</div>
                      <div className="mt-1 font-display text-[34px] font-semibold leading-none text-ok">
                        <LiveDuration since={me.since.toISOString()} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-muted">You are not clocked in</div>
                      <div className="mt-1 font-display text-[34px] font-semibold leading-none">{hours(me?.todayMinutes ?? 0)}</div>
                      <div className="text-xs text-muted">logged today</div>
                    </>
                  )}
                </div>
                <form action={me?.since ? clockOutAction : clockInAction} className="flex flex-col gap-2 sm:w-72">
                  <input type="hidden" name="back" value={back} />
                  <label className="sr-only" htmlFor="clock-note">
                    What are you working on? (optional)
                  </label>
                  <input id="clock-note" name="note" maxLength={300} placeholder="What are you working on? (optional)" className="input input-sm" />
                  <button className={me?.since ? "btn btn-danger" : "btn btn-primary"}>
                    <Icon name="clock" size={16} /> {me?.since ? "Clock out" : "Clock in"}
                  </button>
                </form>
              </div>
            </Card>

            <Card title={`My week · ${hours(myWeek)}`} icon="trend">
              <ul className="flex flex-col gap-2">
                {days.map((d) => {
                  const m = worked.get(user.id)?.get(d) ?? 0;
                  const pct = Math.min(100, (m / (10 * 60)) * 100);
                  return (
                    <li key={d} className="grid grid-cols-[96px_minmax(0,1fr)_72px] items-center gap-3 text-sm">
                      <span className={d === today ? "font-semibold text-accent" : "text-muted"}>{dayLabel(d)}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                        <span className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{m > 0 ? hours(m) : "—"}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card title="My hours this week" icon="list" bodyClass="p-0">
              {mine.length ? (
                <ScrollX label="My hours">
                  <table className="table min-w-[620px]">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                        <th scope="col">Time</th>
                        <th scope="col">Note</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mine.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap">{dayLabel(cairoYmd(e.startedAt))}</td>
                          <td className="tabular-nums">{hhmm(e.startedAt)}</td>
                          <td className="tabular-nums">{e.endedAt ? (cairoYmd(e.endedAt) === cairoYmd(e.startedAt) || e.autoStopped ? hhmm(e.endedAt) : formatCairo(e.endedAt)) : <span className="chip chip-ok">running</span>}</td>
                          <td className="tabular-nums">{hours((effectiveEnd(e, now).getTime() - e.startedAt.getTime()) / 60_000)}</td>
                          <td className="max-w-[220px] truncate text-muted">
                            {e.autoStopped && <span className="chip chip-warn mr-1.5">stopped at midnight</span>}
                            {e.note ?? ""}
                          </td>
                          <td className="whitespace-nowrap text-right">
                            <Link href={base({ entry: String(e.id) })} className="btn btn-ghost btn-sm" aria-label={`Fix the hours from ${hhmm(e.startedAt)}`}>
                              <Icon name="edit" size={14} />
                            </Link>
                            <form action={deleteHoursAction} className="inline">
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="back" value={back} />
                              <ConfirmButton className="btn btn-ghost btn-sm" aria-label={`Remove the hours from ${hhmm(e.startedAt)}`} message="Remove these hours?">
                                <Icon name="trash" size={14} />
                              </ConfirmButton>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollX>
              ) : (
                <EmptyState icon="clock" title="No hours this week">
                  Clock in when you start and out when you stop, or add hours by hand.
                </EmptyState>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card title={entry ? "Fix these hours" : "Add hours by hand"} icon="edit">
              <p className="mb-4 text-sm text-muted">Forgot to clock in or out, or worked away from the app? Log it here. Hours cannot overlap or be in the future.</p>
              <form action={saveHoursAction} className="flex flex-col gap-3">
                <input type="hidden" name="back" value={base({})} />
                <input type="hidden" name="userId" value={user.id} />
                {entry && <input type="hidden" name="id" value={entry.id} />}
                <label className="field">
                  From
                  <input type="datetime-local" name="start" required defaultValue={entry ? toCairoLocalInput(entry.startedAt) : `${today}T09:00`} className="input input-sm" />
                </label>
                <label className="field">
                  To{entry && !entry.endedAt ? " (leave empty while still working)" : ""}
                  <input type="datetime-local" name="end" required={!entry || !!entry.endedAt} defaultValue={entry?.endedAt ? toCairoLocalInput(entry.endedAt) : entry ? "" : `${today}T17:00`} className="input input-sm" />
                </label>
                <label className="field">
                  Note (optional)
                  <input name="note" maxLength={300} defaultValue={entry?.note ?? ""} className="input input-sm" />
                </label>
                <div className="flex justify-end gap-2">
                  {entry && (
                    <Link href={base({})} className="btn btn-ghost btn-sm">
                      Cancel
                    </Link>
                  )}
                  <button className="btn btn-primary btn-sm">{entry ? "Save hours" : "Add hours"}</button>
                </div>
              </form>
            </Card>
            {eventForm}
          </div>
        </div>
      )}
    </>
  );
}
