import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
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

const kind = sql`(select s.kind from stages s where s.key = ${leads.stage})`;
const isOpen = sql`${kind} = 'open'`;
export const lastActivitySql = sql`coalesce((select max(a.at) from activities a where a.lead_id = ${leads.id}), ${leads.createdAt})`;
export const lastStageSql = sql`coalesce((select max(e.at) from stage_events e where e.lead_id = ${leads.id}), ${leads.createdAt})`;
export const hasOpenFollowUpSql = sql`exists (select 1 from follow_ups f where f.lead_id = ${leads.id} and f.done_at is null and f.cancelled_at is null)`;

export function viewCondition(key: ViewKey, s: Settings, now = new Date()): SQL {
  const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  switch (key) {
    case "uncontacted":
      return sql`(${isOpen} and ${leads.firstContactAt} is null)`;
    case "no_next_step":
      return sql`(${kind} in ('open', 'nurture') and not ${hasOpenFollowUpSql})`;
    case "neglected":
      return sql`(${isOpen} and ${lastActivitySql} < ${iso(new Date(now.getTime() - s.neglectDays * 86_400_000))})`;
    case "stale":
      return sql`(${isOpen} and ${lastStageSql} < ${iso(new Date(now.getTime() - s.staleDays * 86_400_000))})`;
    case "decision_due":
      return sql`(${leads.stage} = 'offer_sent' and (
        (${leads.decisionDueAt} is not null and ${leads.decisionDueAt} < ${iso(startOfNextCairoDay(now))})
        or (${leads.decisionDueAt} is null and ${lastStageSql} <= ${iso(new Date(now.getTime() - s.decisionDueDays * 86_400_000))})))`;
    case "consult_week":
      return sql`exists (select 1 from consults c where c.lead_id = ${leads.id} and not c.held and c.outcome is null
        and c.scheduled_at >= ${iso(startOfCairoDay(now))} and c.scheduled_at < ${iso(new Date(startOfCairoDay(now).getTime() + 7 * 86_400_000))})`;
    case "no_decision_review":
      return sql`(${kind} = 'lost' and ${leads.lostReviewedAt} is null
        and exists (select 1 from lost_reasons r where r.id = ${leads.lostReasonId} and r.kind = 'no_decision'))`;
    case "nurture_review":
      return sql`('nurture-review' = any(${leads.tags}) and ${leads.lostReviewedAt} is null)`;
  }
}

export type ViewCounts = Record<ViewKey, number>;

export async function viewCounts(db: Db, now = new Date(), settings?: Settings): Promise<ViewCounts> {
  const s = settings ?? (await getSettings(db));
  const cols = Object.fromEntries(VIEW_ORDER.map((k) => [k, sql<number>`count(*) filter (where ${viewCondition(k, s, now)})::int`]));
  const [r] = await db
    .select(cols as Record<ViewKey, SQL<number>>)
    .from(leads)
    .where(sql`${leads.deletedAt} is null`);
  return r as ViewCounts;
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
