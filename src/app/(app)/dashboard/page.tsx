import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, cohorts, sources, users } from "@/db/schema";
import { getMetrics, type MetricFilters } from "@/lib/metrics";
import { fmtDays, fmtEgp, fmtMinutes, fmtRate } from "@/lib/metrics-format";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { BarList, Columns, Split } from "@/components/charts";
import { Card, Icon, PageHeader, pretty, type IconName } from "@/components/ui";
import { addDaysYmd, cairoYmd } from "@/lib/time";

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const int = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

type SP = Record<string, string | undefined>;

function Tile({ label, value, hint, icon, hero }: { label: string; value: string; hint?: string; icon: IconName; hero?: boolean }) {
  return (
    <div data-stat={label} className={`card relative overflow-hidden p-4 ${hero ? "border-brand/40" : ""}`}>
      {hero && <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />}
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <div>{label}</div>
        <Icon name={icon} className={hero ? "text-accent" : "text-muted"} />
      </div>
      <div className={`mt-2 font-semibold leading-none tracking-tight ${hero ? "text-[34px]" : "text-[28px]"}`}>{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function List({ rows, empty = "None" }: { rows: { label: string; value: string }[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <dl className="divide-y divide-line/60 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 py-1.5">
          <dt dir="auto" className="text-fg/90">
            {r.label}
          </dt>
          <dd className="num font-medium">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const metadata = { title: "Dashboard" };

export default async function DashboardPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const seeMoney = can(user.role, "finance:read");
  const today = cairoYmd(new Date());
  const explicit = searchParams.from || searchParams.to || searchParams.all;
  const f: MetricFilters = {
    from: ymd(searchParams.from) ?? (explicit ? undefined : addDaysYmd(today, -90)),
    to: ymd(searchParams.to),
    source: int(searchParams.source),
    campaign: int(searchParams.campaign),
    segment: SEGMENTS.includes(searchParams.segment ?? "") ? searchParams.segment : undefined,
    owner: searchParams.owner === "none" ? "none" : int(searchParams.owner),
    cohort: int(searchParams.cohort),
  };

  const [m, srcs, camps, owners, cohs] = await Promise.all([
    getMetrics(db, f),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select().from(campaigns).orderBy(asc(campaigns.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select({ id: cohorts.id, name: cohorts.name }).from(cohorts).orderBy(asc(cohorts.id)),
  ]);
  const top = m.funnel[0]?.count ?? 0;
  const maxWeek = Math.max(1, ...m.weekly.flatMap((w) => [w.leads, w.consults, w.enrolments]));

  const presets = [
    { label: "30 days", href: `/dashboard?from=${addDaysYmd(today, -30)}` },
    { label: "90 days", href: "/dashboard" },
    { label: "All time", href: "/dashboard?all=1" },
  ];
  const presetActive = (href: string) =>
    href === "/dashboard" ? !explicit : href === "/dashboard?all=1" ? !!searchParams.all && !searchParams.from : searchParams.from === href.split("=")[1] && !searchParams.to;
  const weeks = m.weekly.map((w) => ({ x: w.week.slice(5), label: `Week of ${w.week}` , w }));

  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Dashboard"
        subtitle={
          <>
            Leads created {f.from ? `from ${f.from}` : "at any time"}
            {f.to ? ` to ${f.to}` : ""} · <span className="num">{m.totalLeads}</span> leads. Percentages need 5 or more records; below that the count is shown.
          </>
        }
      />

      <form method="get" aria-label="Dashboard filters" className="mb-6 flex flex-wrap items-end gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm" role="group" aria-label="Date range">
          {presets.map((p) => (
            <Link key={p.label} href={p.href} aria-current={presetActive(p.href) ? "true" : undefined} className={`rounded-md px-3 py-1.5 ${presetActive(p.href) ? "bg-raised font-medium" : "text-muted hover:text-fg"}`}>
              {p.label}
            </Link>
          ))}
        </div>
        {!searchParams.from && !searchParams.to && searchParams.all && <input type="hidden" name="all" value="1" />}
        <input type="date" name="from" defaultValue={f.from} aria-label="From" className="input w-auto" />
        <input type="date" name="to" defaultValue={f.to} aria-label="To" className="input w-auto" />
        <select name="source" defaultValue={f.source ?? ""} aria-label="Source" className="input w-auto">
          <option value="">All sources</option>
          {srcs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="campaign" defaultValue={f.campaign ?? ""} aria-label="Campaign" className="input w-auto">
          <option value="">All campaigns</option>
          {camps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select name="segment" defaultValue={f.segment ?? ""} aria-label="Segment" className="input w-auto">
          <option value="">All segments</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {pretty(s)}
            </option>
          ))}
        </select>
        <select name="owner" defaultValue={f.owner === undefined ? "" : String(f.owner)} aria-label="Owner" className="input w-auto">
          <option value="">All owners</option>
          <option value="none">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select name="cohort" defaultValue={f.cohort ?? ""} aria-label="Batch" className="input w-auto">
          <option value="">All batches</option>
          {cohs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary">Apply</button>
        <Link href="/dashboard" className="btn btn-ghost">
          Reset
        </Link>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {seeMoney && <Tile label="Revenue" value={fmtEgp(m.revenue.totalEgp)} hint={`${fmtEgp(m.revenue.collectedEgp)} collected`} icon="trend" hero />}
        <Tile label="Leads" value={String(m.totalLeads)} icon="leads" />
        <Tile label="Enrolments" value={String(m.revenue.enrolments)} hint={`${fmtDays(m.cycle.medianDays)} median sales cycle`} icon="cohorts" />
        <Tile label="Median first contact" value={fmtMinutes(m.speed.medianMinutes)} hint={`${fmtRate(m.speed.within5)} within 5 min`} icon="bolt" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Funnel · leads that ever reached each stage" icon="pipeline" label="Funnel">
          <BarList
            rows={m.funnel.map((s) => ({ label: s.label, value: s.count, note: s.conversion ? `${fmtRate(s.conversion)} of the previous stage` : undefined }))}
            max={top}
            aside={(r) => {
              const c = m.funnel.find((x) => x.label === r.label)?.conversion;
              return c ? fmtRate(c) : "";
            }}
          />
          <p className="mt-4 text-xs text-muted">
            Right-hand figure: share of the previous stage. {m.sideStages.map((s) => `${s.label}: ${s.count}`).join(" · ")} (reached at any point, not part of the path).
          </p>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Speed to lead" icon="bolt">
            <List
              rows={[
                { label: "Median minutes to first contact", value: fmtMinutes(m.speed.medianMinutes) },
                { label: "Contacted within 5 minutes", value: `${fmtRate(m.speed.within5)}${m.speed.within5.small ? "" : ` (${m.speed.within5.num} of ${m.speed.within5.den})`}` },
                { label: "Contacted / not yet contacted", value: `${m.speed.contacted} / ${m.speed.uncontacted}` },
              ]}
            />
          </Card>
          <Card title="Lost: explicit no vs no decision" icon="x">
            <Split a={{ label: "Said no", value: m.leaks.lostExplicit }} b={{ label: "No decision (went silent)", value: m.leaks.lostNoDecision }} />
            <div className="mt-4">
              <div className="eyebrow mb-2">Top lost reasons</div>
              {m.leaks.lostReasons.length ? (
                <BarList rows={m.leaks.lostReasons.map((r) => ({ label: r.label, value: r.count, muted: r.noDecision }))} />
              ) : (
                <p className="text-sm text-muted">None</p>
              )}
            </div>
          </Card>
        </div>

        <Card title="Weekly trend (weeks start Monday, Cairo time)" icon="trend" className="lg:col-span-2">
          {weeks.length === 0 ? (
            <p className="text-sm text-muted">No activity in this selection.</p>
          ) : (
            <>
              <div className="grid gap-6 md:grid-cols-3">
                <Columns title="New leads" total={weeks.reduce((a, w) => a + w.w.leads, 0)} data={weeks.map((w) => ({ x: w.x, label: w.label, v: w.w.leads }))} />
                <Columns title="Consults" total={weeks.reduce((a, w) => a + w.w.consults, 0)} data={weeks.map((w) => ({ x: w.x, label: w.label, v: w.w.consults }))} />
                <Columns title="Enrolments" total={weeks.reduce((a, w) => a + w.w.enrolments, 0)} data={weeks.map((w) => ({ x: w.x, label: w.label, v: w.w.enrolments }))} />
              </div>
              <details className="mt-4">
                <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
                  <Icon name="list" size={13} /> Show as a table
                </summary>
                <table className="table mt-2">
                  <thead>
                    <tr>
                      <th>Week of</th>
                      <th className="text-right">New leads</th>
                      <th className="text-right">Consults</th>
                      <th className="text-right">Enrolments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.weekly.map((w) => (
                      <tr key={w.week}>
                        <td className="num">{w.week}</td>
                        <td className="num text-right">{w.leads}</td>
                        <td className="num text-right">{w.consults}</td>
                        <td className="num text-right">{w.enrolments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </Card>

        <Card title="Consults and sales cycle" icon="phone">
          <List
            rows={[
              { label: "Booked", value: String(m.consults.booked) },
              { label: "Held", value: String(m.consults.held) },
              { label: "No-shows", value: String(m.consults.noShow) },
              { label: "Still to happen", value: String(m.consults.pending) },
              { label: "Awaiting a result (time has passed)", value: String(m.consults.awaiting) },
              { label: "Show-up rate (held / held + no-show)", value: fmtRate(m.consults.showUp) },
              { label: "Consult to enrolment", value: fmtRate(m.consults.toEnrolment) },
              { label: `Sales cycle, median (${m.cycle.enrolled} enrolled)`, value: fmtDays(m.cycle.medianDays) },
            ]}
          />
        </Card>

        {seeMoney && (
          <Card title="Revenue" icon="trend">
            <div className="eyebrow mb-2">By tier</div>
            <BarList rows={m.revenue.byTier.map((r) => ({ label: pretty(r.tier), value: r.egp, note: `${r.count} enrolled` }))} unit=" EGP" />
            <div className="eyebrow mb-2 mt-5">By batch</div>
            <List rows={m.revenue.byCohort.map((r) => ({ label: r.name, value: `${r.count} · ${fmtEgp(r.egp)}` }))} />
            <div className="eyebrow mb-2 mt-5">By source</div>
            <List rows={m.revenue.bySource.map((r) => ({ label: r.label, value: `${r.count} · ${fmtEgp(r.egp)}` }))} />
          </Card>
        )}

        <Card title="Source quality" icon="target">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Enrolled</th>
                <th className="text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {m.sources.map((s) => (
                <tr key={s.label}>
                  <td>{s.label}</td>
                  <td className="num text-right">{s.leads}</td>
                  <td className="num text-right">{s.enrolled}</td>
                  <td className="num text-right">{fmtRate(s.rate)}</td>
                </tr>
              ))}
              {m.campaigns.map((s) => (
                <tr key={`c-${s.label}`}>
                  <td dir="auto">
                    <span className="chip mr-1.5">campaign</span>
                    {s.label}
                  </td>
                  <td className="num text-right">{s.leads}</td>
                  <td className="num text-right">{s.enrolled}</td>
                  <td className="num text-right">{fmtRate(s.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Top objections" icon="alert">
          {m.leaks.objections.length ? <BarList rows={m.leaks.objections.map((r) => ({ label: r.label, value: r.count }))} /> : <p className="text-sm text-muted">None recorded.</p>}
        </Card>
      </div>
    </>
  );
}
