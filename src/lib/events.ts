import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, eventAttendance, leads } from "@/db/schema";
import { audit } from "./audit";
import { bulkCadence, type BulkResult } from "./bulk";
import { logActivity } from "./leads";

// Masterclasses and events: campaigns of those kinds. Registrants are the leads tagged to the campaign, those
// who signed up on one of its forms, and anyone added by hand (an attendance row).
const REGISTRANT = (campaignId: number | SQL) => sql`
  l.deleted_at is null and (l.campaign_id = ${campaignId}
    or exists (select 1 from form_submissions s join lead_forms f on f.id = s.form_id where s.lead_id = l.id and f.campaign_id = ${campaignId})
    or exists (select 1 from event_attendance a where a.lead_id = l.id and a.campaign_id = ${campaignId}))`;

export type EventRow = {
  id: number;
  label: string;
  kind: string;
  status: string;
  eventAt: Date | null;
  registered: number;
  reminded: number;
  attended: number;
  noShow: number;
  consultedAfter: number; // attendees who held a consult after the event
  enrolled: number; // registrants who enrolled (any time)
};

export async function listEvents(db: Db): Promise<EventRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select g.id, g.label, g.kind, g.status, g.event_at,
      (select count(*) from leads l where ${REGISTRANT(sql`g.id`)})::int as registered,
      (select count(*) from event_attendance a where a.campaign_id = g.id and a.reminded_at is not null)::int as reminded,
      (select count(*) from event_attendance a where a.campaign_id = g.id and a.attended)::int as attended,
      (select count(*) from event_attendance a where a.campaign_id = g.id and a.attended = false)::int as no_show,
      (select count(*) from event_attendance a where a.campaign_id = g.id and a.attended
         and exists (select 1 from consults c where c.lead_id = a.lead_id and c.held and c.scheduled_at >= coalesce(g.event_at, '-infinity')))::int as consulted_after,
      (select count(*) from leads l where ${REGISTRANT(sql`g.id`)} and exists (select 1 from enrolments e where e.lead_id = l.id))::int as enrolled
    from campaigns g where g.kind in ('masterclass', 'event')
    order by g.event_at desc nulls last, g.id desc`);
  return [...rows].map((r) => ({
    id: Number(r.id),
    label: String(r.label),
    kind: String(r.kind),
    status: String(r.status),
    eventAt: r.event_at ? new Date(r.event_at as string) : null,
    registered: Number(r.registered),
    reminded: Number(r.reminded),
    attended: Number(r.attended),
    noShow: Number(r.no_show),
    consultedAfter: Number(r.consulted_after),
    enrolled: Number(r.enrolled),
  }));
}

export type Registrant = {
  id: number;
  fullName: string;
  phone: string | null;
  doNotContact: boolean;
  stage: string;
  attended: boolean | null;
  remindedAt: Date | null;
  consultedAfter: boolean;
  enrolled: boolean;
  signedUpAt: Date;
};

export async function registrants(db: Db, campaignId: number): Promise<Registrant[]> {
  const [g] = await db.select({ eventAt: campaigns.eventAt }).from(campaigns).where(eq(campaigns.id, campaignId));
  const since = g?.eventAt?.toISOString() ?? "-infinity";
  const rows = await db.execute<Record<string, unknown>>(sql`
    select l.id, l.full_name, l.phone_whatsapp, l.do_not_contact, l.stage, a.attended, a.reminded_at,
      exists (select 1 from consults c where c.lead_id = l.id and c.held and c.scheduled_at >= ${since}::timestamptz) as consulted_after,
      exists (select 1 from enrolments e where e.lead_id = l.id) as enrolled,
      coalesce((select min(s.created_at) from form_submissions s join lead_forms f on f.id = s.form_id where s.lead_id = l.id and f.campaign_id = ${campaignId}), l.created_at) as signed_up_at
    from leads l left join event_attendance a on a.lead_id = l.id and a.campaign_id = ${campaignId}
    where ${REGISTRANT(campaignId)}
    order by signed_up_at, l.id`);
  return [...rows].map((r) => ({
    id: Number(r.id),
    fullName: String(r.full_name),
    phone: (r.phone_whatsapp as string | null) ?? null,
    doNotContact: Boolean(r.do_not_contact),
    stage: String(r.stage),
    attended: r.attended == null ? null : Boolean(r.attended),
    remindedAt: r.reminded_at ? new Date(r.reminded_at as string) : null,
    consultedAfter: Boolean(r.consulted_after),
    enrolled: Boolean(r.enrolled),
    signedUpAt: new Date(r.signed_up_at as string),
  }));
}

async function upsert(db: Db, campaignId: number, leadId: number, set: Partial<typeof eventAttendance.$inferInsert>) {
  await db
    .insert(eventAttendance)
    .values({ campaignId, leadId, ...set })
    .onConflictDoUpdate({ target: [eventAttendance.campaignId, eventAttendance.leadId], set: { ...set, updatedAt: new Date() } });
}

/** Add someone who registered by message or at the door. Their campaign is set if they had none. */
export async function addRegistrant(db: Db, campaignId: number, leadId: number, userId: number | null) {
  const [l] = await db.select({ campaignId: leads.campaignId, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, leadId));
  if (!l || l.deletedAt) return { ok: false as const, error: "Lead not found" };
  if (!l.campaignId) await db.update(leads).set({ campaignId, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await upsert(db, campaignId, leadId, { markedBy: userId });
  await audit(db, { userId, entity: "event", entityId: campaignId, action: "register", diff: { leadId } });
  return { ok: true as const };
}

/** The reminder was sent (from WhatsApp): recorded on the event and logged as an outbound WhatsApp. */
export async function markReminded(db: Db, campaignId: number, leadId: number, userId: number | null, note = "Event reminder sent") {
  await upsert(db, campaignId, leadId, { remindedAt: new Date(), markedBy: userId });
  await logActivity(db, { leadId, type: "whatsapp", direction: "out", body: note }, userId);
}

/** After the event: who came. Only the people listed change. */
export async function setAttendance(db: Db, campaignId: number, marks: { leadId: number; attended: boolean | null }[], userId: number | null) {
  for (const m of marks) await upsert(db, campaignId, m.leadId, { attended: m.attended, markedBy: userId });
  await audit(db, { userId, entity: "event", entityId: campaignId, action: "attendance", diff: { marked: marks.length } });
}

/** Start a cadence for those who came (or did not). Won and lost leads, and running cadences, are skipped. */
export async function followUpAfterEvent(db: Db, campaignId: number, who: "attended" | "no_show", templateId: number, userId: number | null): Promise<BulkResult> {
  const rows = await db
    .select({ leadId: eventAttendance.leadId })
    .from(eventAttendance)
    .innerJoin(leads, eq(leads.id, eventAttendance.leadId))
    .where(and(eq(eventAttendance.campaignId, campaignId), eq(eventAttendance.attended, who === "attended"), sql`${leads.deletedAt} is null`, sql`not ${leads.doNotContact}`));
  return bulkCadence(db, rows.map((r) => r.leadId), templateId, userId);
}

/** Of these ids, the ones registered for the event (form posts carry ids; never trust them blindly). */
export async function eventLeadIds(db: Db, campaignId: number, ids: number[]) {
  const clean = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
  if (!clean.length) return [];
  const rows = await db.execute<{ id: number }>(sql`select l.id from leads l where l.id in (${sql.join(clean.map((n) => sql`${n}`), sql`, `)}) and ${REGISTRANT(campaignId)}`);
  return [...rows].map((r) => Number(r.id));
}
