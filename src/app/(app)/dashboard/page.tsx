import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, cohorts, sources, users } from "@/db/schema";
import { getMetrics, type MetricFilters } from "@/lib/metrics";
import { fmtDays, fmtEgp, fmtMinutes, fmtRate } from "@/lib/metrics-format";
import { requireUser } from "@/lib/server-auth";
import { addDaysYmd, cairoYmd } from "@/lib/time";

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const pretty = (s: string) => s.replace(/_/g, " ");
const field = "rounded border border-line bg-surface px-2 py-1.5 text-sm";
const int = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

type SP = Record<string, string | undefined>;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-line bg-surface">
      <h2 className="border-b border-line px-3 py-2 text-sm font-medium">{title}</h2>
      <div className="p-3 text-sm">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-line bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 flex-1 rounded bg-bg" aria-hidden>
      <div className="h-2 rounded bg-gold" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

function List({ rows, empty = "None" }: { rows: { label: string; value: string }[]; empty?: string }) {
  if (!rows.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.label} className="flex justify-between gap-3">
          <span dir="auto">{r.label}</span>
          <span className="text-muted">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage(props: { searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  await requireUser();
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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl">Dashboard</h1>
        <span className="text-sm text-muted">
          Leads created {f.from ? `from ${f.from}` : "at any time"}
          {f.to ? ` to ${f.to}` : ""} · {m.totalLeads} leads
        </span>
        <Link href="/dashboard?all=1" className="ml-auto text-xs text-muted underline">
          All time
        </Link>
      </div>

      <form method="get" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label="Dashboard filters">
        {!searchParams.from && !searchParams.to && searchParams.all && <input type="hidden" name="all" value="1" />}
        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input type="date" name="from" defaultValue={f.from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <input type="date" name="to" defaultValue={f.to} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Source
          <select name="source" defaultValue={f.source ?? ""} className={field}>
            <option value="">All</option>
            {srcs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Campaign
          <select name="campaign" defaultValue={f.campaign ?? ""} className={field}>
            <option value="">All</option>
            {camps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Segment
          <select name="segment" defaultValue={f.segment ?? ""} className={field}>
            <option value="">All</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Owner
          <select name="owner" defaultValue={f.owner === undefined ? "" : String(f.owner)} className={field}>
            <option value="">All</option>
            <option value="none">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Cohort
          <select name="cohort" defaultValue={f.cohort ?? ""} className={field}>
            <option value="">All</option>
            {cohs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Apply</button>
          <Link href="/dashboard" className="py-1.5 text-sm text-muted">
            Reset
          </Link>
        </div>
      </form>

      <p className="mb-4 text-xs text-muted">
        Filters pick a set of leads (created in the range, matching source, campaign, segment, owner; cohort = enrolled in it).
        Every figure is computed over those leads and their own history. Percentages need 5 or more records; below that the count is shown.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Leads" value={String(m.totalLeads)} />
        <Stat label="Enrolments" value={String(m.revenue.enrolments)} hint={`${fmtDays(m.cycle.medianDays)} median sales cycle`} />
        <Stat label="Revenue" value={fmtEgp(m.revenue.totalEgp)} hint={`${fmtEgp(m.revenue.collectedEgp)} collected`} />
        <Stat label="Median first contact" value={fmtMinutes(m.speed.medianMinutes)} hint={`${fmtRate(m.speed.within5)} within 5 min`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Funnel (leads that ever reached each stage)">
          <table className="w-full">
            <tbody>
              {m.funnel.map((s) => (
                <tr key={s.key}>
                  <td className="w-32 py-1 pr-2">{s.label}</td>
                  <td className="w-12 py-1 text-right tabular-nums">{s.count}</td>
                  <td className="px-2 py-1">
                    <div className="flex">
                      <Bar value={s.count} max={top} />
                    </div>
                  </td>
                  <td className="w-16 py-1 text-right text-muted tabular-nums" title="of the previous stage">
                    {s.conversion ? fmtRate(s.conversion) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            {m.sideStages.map((s) => `${s.label}: ${s.count}`).join(" · ")} (reached at any point, not part of the path above)
          </p>
        </Card>

        <Card title="Speed to lead">
          <List
            rows={[
              { label: "Median minutes to first contact", value: fmtMinutes(m.speed.medianMinutes) },
              { label: "Contacted within 5 minutes", value: `${fmtRate(m.speed.within5)}${m.speed.within5.small ? "" : ` (${m.speed.within5.num} of ${m.speed.within5.den})`}` },
              { label: "Contacted / not yet contacted", value: `${m.speed.contacted} / ${m.speed.uncontacted}` },
            ]}
          />
        </Card>

        <Card title="Consults and sales cycle">
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

        <Card title="Revenue">
          <p className="mb-2">
            {fmtEgp(m.revenue.totalEgp)} from {m.revenue.enrolments} enrolments ({fmtEgp(m.revenue.collectedEgp)} collected)
          </p>
          <h3 className="mb-1 text-xs uppercase text-muted">By tier</h3>
          <List rows={m.revenue.byTier.map((r) => ({ label: pretty(r.tier), value: `${r.count} · ${fmtEgp(r.egp)}` }))} />
          <h3 className="mb-1 mt-3 text-xs uppercase text-muted">By cohort</h3>
          <List rows={m.revenue.byCohort.map((r) => ({ label: r.name, value: `${r.count} · ${fmtEgp(r.egp)}` }))} />
          <h3 className="mb-1 mt-3 text-xs uppercase text-muted">By source</h3>
          <List rows={m.revenue.bySource.map((r) => ({ label: r.label, value: `${r.count} · ${fmtEgp(r.egp)}` }))} />
        </Card>

        <Card title="Where leads leak">
          <h3 className="mb-1 text-xs uppercase text-muted">Top lost reasons</h3>
          <List rows={m.leaks.lostReasons.map((r) => ({ label: r.label, value: String(r.count) }))} />
          <h3 className="mb-1 mt-3 text-xs uppercase text-muted">Top objections</h3>
          <List rows={m.leaks.objections.map((r) => ({ label: r.label, value: String(r.count) }))} />
        </Card>

        <Card title="Source quality">
          <table className="w-full text-left">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="pb-1">Source</th>
                <th className="pb-1 text-right">Leads</th>
                <th className="pb-1 text-right">Enrolled</th>
                <th className="pb-1 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {m.sources.map((s) => (
                <tr key={s.label}>
                  <td className="py-0.5">{s.label}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.leads}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.enrolled}</td>
                  <td className="py-0.5 text-right tabular-nums">{fmtRate(s.rate)}</td>
                </tr>
              ))}
              {m.campaigns.length > 0 && (
                <tr>
                  <td colSpan={4} className="pt-3 text-xs uppercase text-muted">
                    Campaigns
                  </td>
                </tr>
              )}
              {m.campaigns.map((s) => (
                <tr key={`c-${s.label}`}>
                  <td className="py-0.5" dir="auto">
                    {s.label}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{s.leads}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.enrolled}</td>
                  <td className="py-0.5 text-right tabular-nums">{fmtRate(s.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Weekly trend (weeks start Monday, Cairo time)">
          {m.weekly.length === 0 ? (
            <p className="text-muted">No activity in this selection.</p>
          ) : (
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="pb-1">Week of</th>
                  <th className="pb-1">New leads</th>
                  <th className="pb-1">Consults</th>
                  <th className="pb-1">Enrolments</th>
                </tr>
              </thead>
              <tbody>
                {m.weekly.map((w) => (
                  <tr key={w.week}>
                    <td className="py-1 pr-3 tabular-nums">{w.week}</td>
                    {([w.leads, w.consults, w.enrolments] as const).map((v, i) => (
                      <td key={i} className="py-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right tabular-nums">{v}</span>
                          <Bar value={v} max={maxWeek} />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
