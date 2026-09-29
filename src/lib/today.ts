import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { startOfCairoDay, startOfNextCairoDay } from "./time";

export const DECISION_DUE_DAYS = 3;
export const TODAY_LIMIT = 50; // rows shown per section; the count badge always shows the true total

export type TodayFollowUp = {
  id: number;
  leadId: number;
  leadName: string;
  phone: string | null;
  dueAt: Date;
  kind: string;
  note: string | null;
  fromCadence: boolean;
};
export type TodayLead = { id: number; fullName: string; phone: string | null; createdAt: Date; firstContactAt: Date | null; daysInStage?: number };
export type TodayConsult = { id: number; leadId: number; leadName: string; phone: string | null; scheduledAt: Date; held: boolean; outcome: string | null };

export type Today = {
  uncontacted: TodayLead[];
  dueToday: TodayFollowUp[];
  overdue: TodayFollowUp[];
  consultsToday: TodayConsult[];
  decisionsDue: TodayLead[];
  totals: { uncontacted: number; overdue: number; dueToday: number; decisionsDue: number };
};

const d = (v: unknown) => (v ? new Date(v as string) : null) as Date;

// ownerId: restrict to one owner's leads ("mine"); undefined = everyone.
export async function getToday(db: Db, opts: { now?: Date; ownerId?: number } = {}): Promise<Today> {
  const now = opts.now ?? new Date();
  const dayStart = startOfCairoDay(now).toISOString();
  const dayEnd = startOfNextCairoDay(now).toISOString();
  const decisionCutoff = new Date(now.getTime() - DECISION_DUE_DAYS * 86_400_000).toISOString();
  const own = opts.ownerId ? sql`and l.owner_id = ${opts.ownerId}` : sql``;

  const uncontacted = (await db.execute(sql`
    select l.id, l.full_name, l.phone_whatsapp, l.created_at, l.first_contact_at
    from leads l join stages s on s.key = l.stage
    where l.deleted_at is null and l.first_contact_at is null and s.kind = 'open' ${own}
    order by l.created_at asc limit ${TODAY_LIMIT}`)) as unknown as Record<string, unknown>[];

  const fu = async (cond: ReturnType<typeof sql>) =>
    (await db.execute(sql`
      select f.id, f.lead_id, l.full_name, l.phone_whatsapp, f.due_at, f.kind, f.note, f.template_id is not null as from_cadence
      from follow_ups f join leads l on l.id = f.lead_id
      where f.done_at is null and f.cancelled_at is null and l.deleted_at is null ${own} and ${cond}
      order by f.due_at asc limit ${TODAY_LIMIT}`)) as unknown as Record<string, unknown>[];
  const mapFu = (r: Record<string, unknown>): TodayFollowUp => ({
    id: r.id as number,
    leadId: r.lead_id as number,
    leadName: r.full_name as string,
    phone: r.phone_whatsapp as string | null,
    dueAt: d(r.due_at),
    kind: r.kind as string,
    note: r.note as string | null,
    fromCadence: r.from_cadence as boolean,
  });
  const dueToday = (await fu(sql`f.due_at >= ${dayStart}::timestamptz and f.due_at < ${dayEnd}::timestamptz`)).map(mapFu);
  const overdue = (await fu(sql`f.due_at < ${dayStart}::timestamptz`)).map(mapFu);

  const consults = (await db.execute(sql`
    select c.id, c.lead_id, l.full_name, l.phone_whatsapp, c.scheduled_at, c.held, c.outcome
    from consults c join leads l on l.id = c.lead_id
    where l.deleted_at is null ${own} and c.scheduled_at >= ${dayStart}::timestamptz and c.scheduled_at < ${dayEnd}::timestamptz
    order by c.scheduled_at asc`)) as unknown as Record<string, unknown>[];

  // leads sitting in offer_sent for 3+ days: time in stage = latest event into offer_sent
  const decisions = (await db.execute(sql`
    select id, full_name, phone_whatsapp, created_at, first_contact_at, since from (
      select l.id, l.full_name, l.phone_whatsapp, l.created_at, l.first_contact_at,
        coalesce((select max(e.at) from stage_events e where e.lead_id = l.id and e.to_stage = 'offer_sent'), l.updated_at) as since
      from leads l where l.deleted_at is null and l.stage = 'offer_sent' ${own}) t
    where since <= ${decisionCutoff}::timestamptz order by since asc limit ${TODAY_LIMIT}`)) as unknown as Record<string, unknown>[];

  const n = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)) as unknown as { n: number }[])[0].n);
  const totals = {
    uncontacted: await n(sql`select count(*)::int as n from leads l join stages s on s.key = l.stage
      where l.deleted_at is null and l.first_contact_at is null and s.kind = 'open' ${own}`),
    overdue: await n(sql`select count(*)::int as n from follow_ups f join leads l on l.id = f.lead_id
      where f.done_at is null and f.cancelled_at is null and l.deleted_at is null ${own} and f.due_at < ${dayStart}::timestamptz`),
    dueToday: await n(sql`select count(*)::int as n from follow_ups f join leads l on l.id = f.lead_id
      where f.done_at is null and f.cancelled_at is null and l.deleted_at is null ${own}
        and f.due_at >= ${dayStart}::timestamptz and f.due_at < ${dayEnd}::timestamptz`),
    decisionsDue: await n(sql`select count(*)::int as n from leads l where l.deleted_at is null and l.stage = 'offer_sent' ${own}
      and coalesce((select max(e.at) from stage_events e where e.lead_id = l.id and e.to_stage = 'offer_sent'), l.updated_at) <= ${decisionCutoff}::timestamptz`),
  };

  const lead = (r: Record<string, unknown>): TodayLead => ({
    id: r.id as number,
    fullName: r.full_name as string,
    phone: r.phone_whatsapp as string | null,
    createdAt: d(r.created_at),
    firstContactAt: r.first_contact_at ? d(r.first_contact_at) : null,
    daysInStage: r.since ? Math.floor((now.getTime() - d(r.since).getTime()) / 86_400_000) : undefined,
  });

  return {
    uncontacted: uncontacted.map(lead),
    dueToday,
    overdue,
    consultsToday: consults.map((r) => ({
      id: r.id as number,
      leadId: r.lead_id as number,
      leadName: r.full_name as string,
      phone: r.phone_whatsapp as string | null,
      scheduledAt: d(r.scheduled_at),
      held: r.held as boolean,
      outcome: r.outcome as string | null,
    })),
    decisionsDue: decisions.map(lead),
    totals,
  };
}
