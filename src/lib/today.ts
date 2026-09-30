import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { leads } from "@/db/schema";
import { getSettings, type Settings } from "./app-settings";
import { startOfCairoDay, startOfNextCairoDay } from "./time";
import { viewCondition } from "./views";

export const TODAY_LIMIT = 50; // rows shown per section; the count badge always shows the true total

export type TodayFollowUp = {
  id: number;
  leadId: number;
  leadName: string;
  phone: string | null;
  doNotContact: boolean;
  dueAt: Date;
  kind: string;
  note: string | null;
  fromCadence: boolean;
  fromRule: boolean;
};
export type TodayLead = {
  id: number;
  fullName: string;
  phone: string | null;
  doNotContact: boolean;
  createdAt: Date;
  firstContactAt: Date | null;
  stageLabel?: string;
  decisionDueAt?: Date | null;
  since?: Date;
};
/** Someone is waiting on us: a new lead nobody answered, or a lead whose reply we have not answered. */
export type QueueItem = { leadId: number; fullName: string; phone: string | null; doNotContact: boolean; since: Date; reason: "new" | "replied"; source: string | null };
export type TodayConsult = { id: number; leadId: number; leadName: string; phone: string | null; scheduledAt: Date; held: boolean; outcome: string | null; confirmed: boolean };

export type Today = {
  queue: QueueItem[];
  dueToday: TodayFollowUp[];
  overdue: TodayFollowUp[];
  consultsToday: TodayConsult[];
  decisionsDue: TodayLead[];
  noNextStep: TodayLead[];
  totals: { queue: number; overdue: number; dueToday: number; decisionsDue: number; noNextStep: number; neglected: number };
  settings: Settings;
};

type Row = Record<string, unknown>;
const d = (v: unknown) => new Date(v as string);

// ownerId: restrict to one owner's leads ("mine"); undefined = everyone.
export async function getToday(db: Db, opts: { now?: Date; ownerId?: number } = {}): Promise<Today> {
  const now = opts.now ?? new Date();
  const settings = await getSettings(db);
  const dayStart = startOfCairoDay(now).toISOString();
  const dayEnd = startOfNextCairoDay(now).toISOString();
  const own = opts.ownerId ? sql`and l.owner_id = ${opts.ownerId}` : sql``;
  const ownL = opts.ownerId ? eq(leads.ownerId, opts.ownerId) : undefined;

  // "reply" follow-ups (created by the rules when a lead arrives or replies) belong to the response
  // queue, not to the follow-up lists: they are about someone waiting on us right now.
  const queueSql = sql`
    select l.id as lead_id, l.full_name, l.phone_whatsapp, l.do_not_contact, src.label as source,
      least(
        case when l.first_contact_at is null then l.created_at end,
        (select min(f.created_at) from follow_ups f where f.lead_id = l.id and f.kind = 'reply' and f.done_at is null and f.cancelled_at is null)
      ) as since,
      case when l.first_contact_at is null then 'new' else 'replied' end as reason
    from leads l join stages s on s.key = l.stage left join sources src on src.id = l.source_id
    where l.deleted_at is null and s.kind in ('open', 'nurture') ${own}
      and ((l.first_contact_at is null and s.kind = 'open')
        or exists (select 1 from follow_ups f where f.lead_id = l.id and f.kind = 'reply' and f.done_at is null and f.cancelled_at is null))`;

  const fu = (cond: ReturnType<typeof sql>) => sql`
      select f.id, f.lead_id, l.full_name, l.phone_whatsapp, l.do_not_contact, f.due_at, f.kind, f.note,
        f.template_id is not null as from_cadence, f.rule_id is not null as from_rule
      from follow_ups f join leads l on l.id = f.lead_id
      where f.done_at is null and f.cancelled_at is null and l.deleted_at is null and f.kind <> 'reply' ${own} and ${cond}`;
  const overdueCond = sql`f.due_at < ${dayStart}::timestamptz`;
  const todayCond = sql`f.due_at >= ${dayStart}::timestamptz and f.due_at < ${dayEnd}::timestamptz`;

  const leadCols = {
    id: leads.id,
    fullName: leads.fullName,
    phone: leads.phoneWhatsapp,
    doNotContact: leads.doNotContact,
    createdAt: leads.createdAt,
    firstContactAt: leads.firstContactAt,
    decisionDueAt: leads.decisionDueAt,
    stageLabel: sql<string>`(select s.label from stages s where s.key = "leads"."stage")`,
    since: sql<string>`coalesce((select max(e.at) from stage_events e where e.lead_id = "leads"."id" and e.to_stage = "leads"."stage"), "leads"."created_at")`,
  };
  const decisionWhere = and(isNull(leads.deletedAt), viewCondition("decision_due", settings, now), ownL);
  const nextWhere = and(isNull(leads.deletedAt), viewCondition("no_next_step", settings, now), ownL);
  const neglectWhere = and(isNull(leads.deletedAt), viewCondition("neglected", settings, now), ownL);

  const [queueRows, queueN, overdueRows, overdueN, todayRows, todayN, consultRows, decisions, decisionsN, noNext, noNextN, neglectedN] = await Promise.all([
    db.execute(sql`select * from (${queueSql}) q order by since asc limit ${TODAY_LIMIT}`),
    db.execute(sql`select count(*)::int as n from (${queueSql}) q`),
    db.execute(sql`${fu(overdueCond)} order by f.due_at asc limit ${TODAY_LIMIT}`),
    db.execute(sql`select count(*)::int as n from (${fu(overdueCond)}) x`),
    db.execute(sql`${fu(todayCond)} order by f.due_at asc limit ${TODAY_LIMIT}`),
    db.execute(sql`select count(*)::int as n from (${fu(todayCond)}) x`),
    db.execute(sql`
      select c.id, c.lead_id, l.full_name, l.phone_whatsapp, c.scheduled_at, c.held, c.outcome, c.confirmed_at is not null as confirmed
      from consults c join leads l on l.id = c.lead_id
      where l.deleted_at is null ${own} and c.scheduled_at >= ${dayStart}::timestamptz and c.scheduled_at < ${dayEnd}::timestamptz
      order by c.scheduled_at asc`),
    db.select(leadCols).from(leads).where(decisionWhere).orderBy(sql`${leads.decisionDueAt} asc nulls last`, asc(leads.id)).limit(TODAY_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(decisionWhere),
    db.select(leadCols).from(leads).where(nextWhere).orderBy(asc(leads.updatedAt)).limit(TODAY_LIMIT),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(nextWhere),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(neglectWhere),
  ]);

  const n = (r: unknown) => Number((r as { n: number }[])[0].n);
  const mapFu = (r: Row): TodayFollowUp => ({
    id: r.id as number,
    leadId: r.lead_id as number,
    leadName: r.full_name as string,
    phone: r.phone_whatsapp as string | null,
    doNotContact: r.do_not_contact as boolean,
    dueAt: d(r.due_at),
    kind: r.kind as string,
    note: r.note as string | null,
    fromCadence: r.from_cadence as boolean,
    fromRule: r.from_rule as boolean,
  });
  const mapLead = (r: typeof decisions[number]): TodayLead => ({ ...r, since: d(r.since) });

  return {
    queue: (queueRows as unknown as Row[]).map((r) => ({
      leadId: r.lead_id as number,
      fullName: r.full_name as string,
      phone: r.phone_whatsapp as string | null,
      doNotContact: r.do_not_contact as boolean,
      since: d(r.since),
      reason: r.reason as "new" | "replied",
      source: r.source as string | null,
    })),
    overdue: (overdueRows as unknown as Row[]).map(mapFu),
    dueToday: (todayRows as unknown as Row[]).map(mapFu),
    consultsToday: (consultRows as unknown as Row[]).map((r) => ({
      id: r.id as number,
      leadId: r.lead_id as number,
      leadName: r.full_name as string,
      phone: r.phone_whatsapp as string | null,
      scheduledAt: d(r.scheduled_at),
      held: r.held as boolean,
      outcome: r.outcome as string | null,
      confirmed: r.confirmed as boolean,
    })),
    decisionsDue: decisions.map(mapLead),
    noNextStep: noNext.map(mapLead),
    totals: {
      queue: n(queueN),
      overdue: n(overdueN),
      dueToday: n(todayN),
      decisionsDue: decisionsN[0].n,
      noNextStep: noNextN[0].n,
      neglected: neglectedN[0].n,
    },
    settings,
  };
}
