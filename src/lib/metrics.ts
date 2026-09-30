import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cairoLocalToDate, startOfNextCairoDay } from "./time";
import { rate, type Rate } from "./metrics-format";

/**
 * All dashboard numbers. One rule ties them together: the filters pick a set of LEADS (created in the
 * date range, matching source / campaign / segment / owner, and, for the cohort filter, enrolled in that
 * cohort). Every metric is then computed over that set of leads and their own history, except the weekly
 * trend, which counts events (created / consult scheduled / enrolled) by the week they happened.
 * Conversion is derived from stage_events, never from a lead's current stage.
 */
export type MetricFilters = {
  from?: string; // YYYY-MM-DD (Cairo), lead created on or after
  to?: string; // YYYY-MM-DD (Cairo), inclusive
  source?: number;
  campaign?: number;
  segment?: string;
  owner?: number | "none";
  cohort?: number;
};

export type FunnelStep = { key: string; label: string; count: number; conversion: Rate | null };
export type Count = { label: string; count: number };

export type Metrics = {
  totalLeads: number;
  funnel: FunnelStep[];
  sideStages: { key: string; label: string; count: number }[]; // lost, nurture: reached at any point
  speed: { contacted: number; uncontacted: number; medianMinutes: number | null; within5: Rate };
  consults: { booked: number; held: number; noShow: number; pending: number; awaiting: number; showUp: Rate; toEnrolment: Rate };
  cycle: { enrolled: number; medianDays: number | null };
  revenue: {
    totalEgp: number;
    collectedEgp: number;
    enrolments: number;
    byTier: { tier: string; count: number; egp: number }[];
    byCohort: { id: number; name: string; count: number; egp: number }[];
    bySource: { label: string; count: number; egp: number }[];
  };
  // P5: an explicit "no" and "went silent after the offer" (no decision) are reported apart
  leaks: { lostReasons: (Count & { noDecision: boolean })[]; objections: Count[]; lostExplicit: number; lostNoDecision: number };
  sources: { label: string; leads: number; enrolled: number; rate: Rate }[];
  campaigns: { label: string; leads: number; enrolled: number; rate: Rate }[];
  weekly: { week: string; leads: number; consults: number; enrolments: number }[];
};

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

function selectedLeads(f: MetricFilters): SQL {
  const c: SQL[] = [sql`l.deleted_at is null`];
  const from = f.from ? cairoLocalToDate(`${f.from}T00:00`) : null;
  if (from) c.push(sql`l.created_at >= ${from.toISOString()}::timestamptz`);
  const to = f.to ? cairoLocalToDate(`${f.to}T00:00`) : null;
  if (to) c.push(sql`l.created_at < ${startOfNextCairoDay(to).toISOString()}::timestamptz`);
  if (f.source) c.push(sql`l.source_id = ${f.source}`);
  if (f.campaign) c.push(sql`l.campaign_id = ${f.campaign}`);
  if (f.segment) c.push(sql`l.segment = ${f.segment}::segment`);
  if (f.owner === "none") c.push(sql`l.owner_id is null`);
  else if (f.owner) c.push(sql`l.owner_id = ${f.owner}`);
  if (f.cohort) c.push(sql`exists (select 1 from enrolments en where en.lead_id = l.id and en.cohort_id = ${f.cohort})`);
  return sql.join(c, sql` and `);
}

const WON = sql`(select key from stages where kind = 'won')`;

export async function getMetrics(db: Db, f: MetricFilters = {}, now: Date = new Date()): Promise<Metrics> {
  const sel = sql`sel as (select l.id, l.created_at, l.first_contact_at, l.source_id, l.campaign_id from leads l where ${selectedLeads(f)})`;
  const q = async (body: SQL): Promise<Row[]> => (await db.execute(sql`with ${sel} ${body}`)) as unknown as Row[];

  const [[tot], stageRows, reached, [speed], [cons], [cycle], revTotal, byTier, byCohort, bySource, lost, objs, srcQ, campQ, wLeads, wCons, wEnrol] =
    await Promise.all([
      q(sql`select count(*)::int as n from sel`),
      db.execute(sql`select key, label, kind, position from stages order by position`) as unknown as Promise<Row[]>,
      q(sql`select se.to_stage as stage, count(distinct se.lead_id)::int as n from stage_events se join sel on sel.id = se.lead_id group by se.to_stage`),
      q(sql`select count(*) filter (where first_contact_at is not null)::int as contacted,
              count(*) filter (where first_contact_at is null)::int as uncontacted,
              percentile_cont(0.5) within group (order by extract(epoch from (first_contact_at - created_at)) / 60)
                filter (where first_contact_at is not null) as median_min,
              count(*) filter (where first_contact_at is not null and first_contact_at - created_at <= interval '5 minutes')::int as within5
            from sel`),
      q(sql`select count(*)::int as booked,
              count(*) filter (where c.held)::int as held,
              count(*) filter (where not c.held and c.outcome = 'no_show')::int as no_show,
              count(*) filter (where not c.held and c.outcome is null and c.scheduled_at > ${now.toISOString()}::timestamptz)::int as pending,
              count(*) filter (where not c.held and c.outcome is null and c.scheduled_at <= ${now.toISOString()}::timestamptz)::int as awaiting,
              count(distinct c.lead_id) filter (where c.held)::int as held_leads,
              count(distinct c.lead_id) filter (where c.held and exists (select 1 from enrolments e where e.lead_id = c.lead_id))::int as held_then_enrolled
            from consults c join sel on sel.id = c.lead_id`),
      q(sql`select count(*)::int as n,
              percentile_cont(0.5) within group (order by extract(epoch from (fe.at - sel.created_at)) / 86400) as median_days
            from sel join (select lead_id, min(at) as at from stage_events where to_stage in ${WON} group by lead_id) fe on fe.lead_id = sel.id`),
      q(sql`select count(*)::int as n, coalesce(sum(e.amount_egp), 0)::int as total,
              coalesce(sum(e.amount_egp) filter (where e.paid_at is not null), 0)::int as collected
            from enrolments e join sel on sel.id = e.lead_id`),
      q(sql`select e.tier::text as k, count(*)::int as n, sum(e.amount_egp)::int as egp from enrolments e join sel on sel.id = e.lead_id
            group by e.tier order by sum(e.amount_egp) desc, e.tier`),
      q(sql`select c.id, c.name as k, count(*)::int as n, sum(e.amount_egp)::int as egp from enrolments e join sel on sel.id = e.lead_id
            join cohorts c on c.id = e.cohort_id group by c.id, c.name order by c.id`),
      q(sql`select coalesce(s.label, 'Unknown') as k, count(*)::int as n, sum(e.amount_egp)::int as egp from enrolments e
            join sel on sel.id = e.lead_id left join sources s on s.id = sel.source_id group by s.label order by sum(e.amount_egp) desc, s.label`),
      q(sql`select r.label as k, r.kind as kind, count(*)::int as n from leads l join sel on sel.id = l.id join lost_reasons r on r.id = l.lost_reason_id
            where l.stage in (select key from stages where kind = 'lost') group by r.label, r.kind order by count(*) desc, r.label`),
      q(sql`select o.label as k, count(*)::int as n from consult_objections co join consults c on c.id = co.consult_id
            join sel on sel.id = c.lead_id join objections o on o.id = co.objection_id group by o.label order by count(*) desc, o.label limit 5`),
      q(sql`select coalesce(s.label, 'Unknown') as k, count(*)::int as leads,
              count(*) filter (where exists (select 1 from enrolments e where e.lead_id = sel.id))::int as enrolled
            from sel left join sources s on s.id = sel.source_id group by s.label order by count(*) desc, s.label`),
      q(sql`select cp.label as k, count(*)::int as leads,
              count(*) filter (where exists (select 1 from enrolments e where e.lead_id = sel.id))::int as enrolled
            from sel join campaigns cp on cp.id = sel.campaign_id group by cp.label order by count(*) desc, cp.label`),
      q(sql`select to_char(date_trunc('week', created_at at time zone 'Africa/Cairo'), 'YYYY-MM-DD') as w, count(*)::int as n from sel group by 1`),
      q(sql`select to_char(date_trunc('week', c.scheduled_at at time zone 'Africa/Cairo'), 'YYYY-MM-DD') as w, count(*)::int as n
            from consults c join sel on sel.id = c.lead_id group by 1`),
      q(sql`select to_char(date_trunc('week', fe.at at time zone 'Africa/Cairo'), 'YYYY-MM-DD') as w, count(*)::int as n
            from sel join (select lead_id, min(at) as at from stage_events where to_stage in ${WON} group by lead_id) fe on fe.lead_id = sel.id group by 1`),
    ]);

  // ---- funnel: distinct leads that ever had an event into each stage of the main path ----
  const reachedBy = new Map(reached.map((r) => [String(r.stage), n(r.n)]));
  const chain = stageRows.filter((s) => s.kind === "open" || s.kind === "won");
  const funnel: FunnelStep[] = chain.map((s, i) => {
    const count = reachedBy.get(String(s.key)) ?? 0;
    const prev = i > 0 ? (reachedBy.get(String(chain[i - 1].key)) ?? 0) : null;
    return { key: String(s.key), label: String(s.label), count, conversion: prev === null ? null : rate(count, prev) };
  });
  const sideStages = stageRows
    .filter((s) => s.kind === "lost" || s.kind === "nurture")
    .map((s) => ({ key: String(s.key), label: String(s.label), count: reachedBy.get(String(s.key)) ?? 0 }));

  const totalLeads = n(tot.n);
  const held = n(cons.held);
  const noShow = n(cons.no_show);

  // ---- weekly trend: merge the three series by week (Cairo, Monday start) ----
  const weeks = new Map<string, { leads: number; consults: number; enrolments: number }>();
  const add = (rows: Row[], k: "leads" | "consults" | "enrolments") => {
    for (const r of rows) {
      const w = String(r.w);
      const cur = weeks.get(w) ?? { leads: 0, consults: 0, enrolments: 0 };
      cur[k] += n(r.n);
      weeks.set(w, cur);
    }
  };
  add(wLeads, "leads");
  add(wCons, "consults");
  add(wEnrol, "enrolments");

  return {
    totalLeads,
    funnel,
    sideStages,
    speed: {
      contacted: n(speed.contacted),
      uncontacted: n(speed.uncontacted),
      medianMinutes: speed.median_min === null || speed.median_min === undefined ? null : Number(speed.median_min),
      // denominator is every lead in scope: a lead nobody has contacted yet does not count as fast
      within5: rate(n(speed.within5), totalLeads),
    },
    consults: {
      booked: n(cons.booked),
      held,
      noShow,
      pending: n(cons.pending),
      awaiting: n(cons.awaiting), // time has passed but no result was recorded yet
      // a consult still to happen is neither held nor missed, so it is left out of the show-up rate
      showUp: rate(held, held + noShow),
      toEnrolment: rate(n(cons.held_then_enrolled), n(cons.held_leads)),
    },
    cycle: { enrolled: n(cycle.n), medianDays: cycle.median_days === null || cycle.median_days === undefined ? null : Number(cycle.median_days) },
    revenue: {
      totalEgp: n(revTotal[0].total),
      collectedEgp: n(revTotal[0].collected),
      enrolments: n(revTotal[0].n),
      byTier: byTier.map((r) => ({ tier: String(r.k), count: n(r.n), egp: n(r.egp) })),
      byCohort: byCohort.map((r) => ({ id: n(r.id), name: String(r.k), count: n(r.n), egp: n(r.egp) })),
      bySource: bySource.map((r) => ({ label: String(r.k), count: n(r.n), egp: n(r.egp) })),
    },
    leaks: {
      lostReasons: lost.slice(0, 5).map((r) => ({ label: String(r.k), count: n(r.n), noDecision: r.kind === "no_decision" })),
      lostExplicit: lost.filter((r) => r.kind !== "no_decision").reduce((a, r) => a + n(r.n), 0),
      lostNoDecision: lost.filter((r) => r.kind === "no_decision").reduce((a, r) => a + n(r.n), 0),
      objections: objs.map((r) => ({ label: String(r.k), count: n(r.n) })),
    },
    sources: srcQ.map((r) => ({ label: String(r.k), leads: n(r.leads), enrolled: n(r.enrolled), rate: rate(n(r.enrolled), n(r.leads)) })),
    campaigns: campQ.map((r) => ({ label: String(r.k), leads: n(r.leads), enrolled: n(r.enrolled), rate: rate(n(r.enrolled), n(r.leads)) })),
    weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
  };
}
