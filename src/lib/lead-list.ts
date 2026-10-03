import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, sources, stages, users } from "@/db/schema";
import { DEFAULTS, getSettings, type Settings } from "./app-settings";
import { leadTextMatch } from "./search";
import { hasOpenFollowUpSql, isViewKey, lastActivitySql, lastStageSql, viewCondition } from "./views";
import { cairoLocalToDate, startOfCairoDay } from "./time";

export const PAGE_SIZE = 50;

// The pipeline's order, not the alphabet: "consult_booked" sorted before "contacted" by key.
const stagePosition = sql`(select st.position from stages st where st.key = ${leads.stage})`;
const nextFollowUpSql = sql`(select min(fu.due_at) from follow_ups fu where fu.lead_id = ${leads.id} and fu.done_at is null and fu.cancelled_at is null)`;

export const SORTS = {
  created: leads.createdAt,
  name: leads.fullName,
  stage: stagePosition,
  updated: leads.updatedAt,
  activity: lastActivitySql,
  next: nextFollowUpSql,
} as const;
export type SortKey = keyof typeof SORTS;

export type LeadFilters = {
  q?: string;
  stage?: string;
  source?: string;
  segment?: string;
  tier?: string;
  owner?: string; // user id, or "none"
  from?: string; // YYYY-MM-DD, Cairo
  to?: string; // inclusive
  overdue?: string; // "1"
  view?: string; // smart view key (src/lib/views.ts)
  tag?: string;
  deleted?: string; // "1" = show soft-deleted only
  sort?: string;
  dir?: string;
  page?: string;
};

// Keys stored in a saved view (everything except paging)
export const VIEW_KEYS = ["q", "view", "tag", "stage", "source", "segment", "tier", "owner", "from", "to", "overdue", "sort", "dir"] as const;

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"];

const intOrNull = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : null);

export function buildWhere(f: LeadFilters, now = new Date(), settings: Settings = DEFAULTS): SQL | undefined {
  const c: (SQL | undefined)[] = [f.deleted === "1" ? isNotNull(leads.deletedAt) : isNull(leads.deletedAt)];

  if (f.q?.trim()) c.push(leadTextMatch(f.q));
  if (isViewKey(f.view)) c.push(viewCondition(f.view, settings, now));
  if (f.tag?.trim()) c.push(sql`${f.tag.trim().slice(0, 60)} = any(${leads.tags})`);
  if (f.stage) c.push(eq(leads.stage, f.stage));
  const source = intOrNull(f.source);
  if (source) c.push(eq(leads.sourceId, source));
  if (f.segment && SEGMENTS.includes(f.segment)) c.push(eq(leads.segment, f.segment as (typeof SEGMENTS)[number] as never));
  if (f.tier && TIERS.includes(f.tier)) c.push(eq(leads.tierInterest, f.tier as never));
  if (f.owner === "none") c.push(isNull(leads.ownerId));
  else if (intOrNull(f.owner)) c.push(eq(leads.ownerId, Number(f.owner)));

  const from = f.from ? cairoLocalToDate(f.from) : null;
  if (from) c.push(gte(leads.createdAt, from));
  const to = f.to ? cairoLocalToDate(f.to) : null;
  if (to) c.push(lt(leads.createdAt, new Date(to.getTime() + 24 * 3600_000)));

  if (f.overdue === "1") {
    c.push(sql`exists (select 1 from follow_ups fu where fu.lead_id = ${leads.id}
      and fu.done_at is null and fu.cancelled_at is null and fu.due_at < ${startOfCairoDay(now).toISOString()}::timestamptz)`);
  }
  return and(...c);
}

export function buildOrder(f: LeadFilters) {
  const key: SortKey = (f.sort as SortKey) in SORTS ? (f.sort as SortKey) : "created";
  const col = SORTS[key];
  // leads with no date (no activity yet, nothing scheduled) go last either way
  if (key === "activity" || key === "next") return [f.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`, desc(leads.id)];
  return [f.dir === "asc" ? asc(col) : desc(col), desc(leads.id)];
}

export async function listLeads(db: Db, f: LeadFilters, now = new Date()) {
  const settings = await getSettings(db);
  const where = buildWhere(f, now, settings);
  const page = Math.max(1, intOrNull(f.page) ?? 1);
  const rows = await db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phoneWhatsapp,
      email: leads.email,
      stage: leads.stage,
      stageLabel: stages.label,
      stageKind: stages.kind,
      tags: leads.tags,
      ownerId: leads.ownerId,
      doNotContact: leads.doNotContact,
      lastActivityAt: sql<string>`${lastActivitySql}`,
      lastStageAt: sql<string>`${lastStageSql}`,
      hasOpenFollowUp: sql<boolean>`${hasOpenFollowUpSql}`,
      segment: leads.segment,
      tierInterest: leads.tierInterest,
      source: sources.label,
      owner: users.name,
      createdAt: leads.createdAt,
      firstContactAt: leads.firstContactAt,
      nextFollowUp: sql<Date | null>`${nextFollowUpSql}`,
    })
    .from(leads)
    .leftJoin(stages, eq(stages.key, leads.stage))
    .leftJoin(sources, eq(sources.id, leads.sourceId))
    .leftJoin(users, eq(users.id, leads.ownerId))
    .where(where)
    .orderBy(...buildOrder(f))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / PAGE_SIZE)), settings };
}
