import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import type { IconName } from "@/components/ui/Icon";
import { getSettings, type Settings } from "./app-settings";
import { startOfCairoDay, startOfNextCairoDay } from "./time";

/**
 * Smart views (V1) and lead health flags (P3, P6). Each view is a WHERE condition on `leads`, so the
 * same definition drives the sidebar count, the lead list and the badges. Definitions are in METRICS.md.
 */
export type ViewKey =
  | "uncontacted"
  | "no_next_step"
  | "neglected"
  | "stale"
  | "decision_due"
  | "consult_week"
  | "no_decision_review"
  | "nurture_review";

export const VIEWS: Record<ViewKey, { label: string; icon: IconName; help: string }> = {
  uncontacted: { label: "Uncontacted", icon: "hourglass", help: "Open leads nobody has messaged yet." },
  no_next_step: { label: "No next step", icon: "flag", help: "Open or nurture leads with no open follow-up. Every open lead needs a dated next step." },
  neglected: { label: "Neglected", icon: "alert", help: "Open leads with no logged activity for the neglect threshold. A future follow-up does not hide them." },
  stale: { label: "Stale", icon: "snooze", help: "Open leads that have not changed stage for the stale threshold." },
  decision_due: { label: "Decision due", icon: "target", help: "Offers whose agreed decision date is today or past (or, with no date, older than the decision threshold)." },
  consult_week: { label: "Consults this week", icon: "calendar", help: "Leads with a consult in the next 7 days that has not happened yet." },
  no_decision_review: { label: "No-decision review", icon: "history", help: "Lost as “no decision” and not reviewed yet: reactivate or close." },
  nurture_review: { label: "Nurture review", icon: "layers", help: "Lost on price or timing: worth a later check-in (tagged by the Lost rule)." },
};
export const VIEW_ORDER = Object.keys(VIEWS) as ViewKey[];
export const isViewKey = (v: unknown): v is ViewKey => typeof v === "string" && v in VIEWS;

// Always table-qualified: drizzle drops the table name for columns in a single-table SELECT list, and
// inside these subqueries an unqualified "id" would silently mean the subquery table's own id.
const L = (c: string) => sql.raw(`"leads"."${c}"`);
const kind = sql`(select s.kind from stages s where s.key = ${L("stage")})`;
const isOpen = sql`${kind} = 'open'`;
export const lastActivitySql = sql`coalesce((select max(a.at) from activities a where a.lead_id = ${L("id")}), ${L("created_at")})`;
export const lastStageSql = sql`coalesce((select max(e.at) from stage_events e where e.lead_id = ${L("id")}), ${L("created_at")})`;
// when the lead entered the stage it is in now (days in stage)
export const stageSinceSql = sql`coalesce((select max(e.at) from stage_events e where e.lead_id = ${L("id")} and e.to_stage = ${L("stage")}), ${L("created_at")})`;
export const hasOpenFollowUpSql = sql`exists (select 1 from follow_ups f where f.lead_id = ${L("id")} and f.done_at is null and f.cancelled_at is null)`;

export function viewCondition(key: ViewKey, s: Settings, now = new Date()): SQL {
  const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  switch (key) {
    case "uncontacted":
      return sql`(${isOpen} and ${L("first_contact_at")} is null)`;
    case "no_next_step":
      return sql`(${kind} in ('open', 'nurture') and not ${hasOpenFollowUpSql})`;
    case "neglected":
      return sql`(${isOpen} and ${lastActivitySql} < ${iso(new Date(now.getTime() - s.neglectDays * 86_400_000))})`;
    case "stale":
      return sql`(${isOpen} and ${lastStageSql} < ${iso(new Date(now.getTime() - s.staleDays * 86_400_000))})`;
    case "decision_due":
      return sql`(${L("stage")} = 'offer_sent' and (
        (${L("decision_due_at")} is not null and ${L("decision_due_at")} < ${iso(startOfNextCairoDay(now))})
        or (${L("decision_due_at")} is null and ${stageSinceSql} <= ${iso(new Date(now.getTime() - s.decisionDueDays * 86_400_000))})))`;
    case "consult_week":
      return sql`exists (select 1 from consults c where c.lead_id = ${L("id")} and not c.held and c.outcome is null
        and c.scheduled_at >= ${iso(startOfCairoDay(now))} and c.scheduled_at < ${iso(new Date(startOfCairoDay(now).getTime() + 7 * 86_400_000))})`;
    case "no_decision_review":
      return sql`(${kind} = 'lost' and ${L("lost_reviewed_at")} is null
        and exists (select 1 from lost_reasons r where r.id = ${L("lost_reason_id")} and r.kind = 'no_decision'))`;
    case "nurture_review":
      return sql`('nurture-review' = any(${L("tags")}) and ${L("lost_reviewed_at")} is null)`;
  }
}

export type ViewCounts = Record<ViewKey, number>;

/**
 * All sidebar counts in one pass. Same definitions as viewCondition, but with the per-lead facts
 * aggregated once (group-by joins) instead of one correlated subquery per row per view: this runs on
 * every page. A test checks each count equals the matching list's total.
 */
export async function viewCounts(db: Db, now = new Date(), settings?: Settings): Promise<ViewCounts> {
  const s = settings ?? (await getSettings(db));
  const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  const dayStart = startOfCairoDay(now);
  const [r] = (await db.execute(sql`
    with la as (select lead_id, max(at) as a from activities group by lead_id),
      se as (select lead_id, max(at) as a from stage_events group by lead_id),
      ss as (select e.lead_id, max(e.at) as a from stage_events e join leads l on l.id = e.lead_id and e.to_stage = l.stage group by e.lead_id),
      fu as (select distinct lead_id from follow_ups where done_at is null and cancelled_at is null),
      cw as (select distinct lead_id from consults where not held and outcome is null
        and scheduled_at >= ${iso(dayStart)} and scheduled_at < ${iso(new Date(dayStart.getTime() + 7 * 86_400_000))}),
      b as (
        select l.id, l.stage, l.first_contact_at, l.decision_due_at, l.lost_reviewed_at, l.tags, st.kind,
          coalesce(la.a, l.created_at) as last_act, coalesce(se.a, l.created_at) as last_stage, coalesce(ss.a, l.created_at) as since,
          fu.lead_id is not null as has_fu, cw.lead_id is not null as consult_week, lr.kind = 'no_decision' as no_decision
        from leads l join stages st on st.key = l.stage
          left join la on la.lead_id = l.id left join se on se.lead_id = l.id left join ss on ss.lead_id = l.id
          left join fu on fu.lead_id = l.id left join cw on cw.lead_id = l.id left join lost_reasons lr on lr.id = l.lost_reason_id
        where l.deleted_at is null)
    select
      count(*) filter (where kind = 'open' and first_contact_at is null)::int as uncontacted,
      count(*) filter (where kind in ('open', 'nurture') and not has_fu)::int as no_next_step,
      count(*) filter (where kind = 'open' and last_act < ${iso(new Date(now.getTime() - s.neglectDays * 86_400_000))})::int as neglected,
      count(*) filter (where kind = 'open' and last_stage < ${iso(new Date(now.getTime() - s.staleDays * 86_400_000))})::int as stale,
      count(*) filter (where stage = 'offer_sent' and ((decision_due_at is not null and decision_due_at < ${iso(startOfNextCairoDay(now))})
        or (decision_due_at is null and since <= ${iso(new Date(now.getTime() - s.decisionDueDays * 86_400_000))})))::int as decision_due,
      count(*) filter (where consult_week)::int as consult_week,
      count(*) filter (where kind = 'lost' and lost_reviewed_at is null and no_decision)::int as no_decision_review,
      count(*) filter (where 'nurture-review' = any(tags) and lost_reviewed_at is null)::int as nurture_review
    from b`)) as unknown as ViewCounts[];
  return r;
}

/** Health flags for one lead row (list, board, detail). */
export type Health = { neglected: boolean; stale: boolean; noNextStep: boolean; daysInStage: number; daysSilent: number };

export function healthOf(
  row: { stageKind: string | null; lastActivityAt: Date | string; lastStageAt: Date | string; hasOpenFollowUp: boolean },
  s: Settings,
  now = new Date(),
): Health {
  const days = (d: Date | string) => Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000));
  const open = row.stageKind === "open";
  const daysSilent = days(row.lastActivityAt);
  const daysInStage = days(row.lastStageAt);
  return {
    neglected: open && now.getTime() - new Date(row.lastActivityAt).getTime() > s.neglectDays * 86_400_000,
    stale: open && now.getTime() - new Date(row.lastStageAt).getTime() > s.staleDays * 86_400_000,
    noNextStep: (open || row.stageKind === "nurture") && !row.hasOpenFollowUp,
    daysInStage,
    daysSilent,
  };
}
