import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, ledgerEntries, sources } from "@/db/schema";
import { audit } from "./audit";
import { dueFor } from "./finance";

export const CAMPAIGN_KINDS = { masterclass: "Masterclass", ads: "Paid ads", collaboration: "Collaboration", organic: "Organic content", event: "Event", referral: "Referral push", other: "Other" } as const;
export const CAMPAIGN_STATUS = { planned: "Planned", live: "Live", ended: "Ended" } as const;
export type CampaignKind = keyof typeof CAMPAIGN_KINDS;
export type CampaignStatus = keyof typeof CAMPAIGN_STATUS;

/** A link-safe name: "Masterclass Oct 2026" → "masterclass-oct-2026". Arabic and other letters drop out. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export type CampaignInput = {
  label: string;
  kind: CampaignKind;
  status: CampaignStatus;
  sourceId?: number | null;
  startedAt?: Date | null;
  endsAt?: Date | null;
  eventAt?: Date | null;
  budgetEgp?: number | null;
  slug?: string | null;
  ownerId?: number | null;
  notes?: string | null;
};
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function saveCampaign(db: Db, id: number | null, input: CampaignInput, userId: number | null): Promise<Result<{ id: number }>> {
  const label = input.label.trim();
  if (!label || label.length > 80) return { ok: false, error: "Name the campaign (up to 80 characters)" };
  if (!(input.kind in CAMPAIGN_KINDS)) return { ok: false, error: "Choose a type" };
  if (!(input.status in CAMPAIGN_STATUS)) return { ok: false, error: "Choose a status" };
  if (input.budgetEgp != null && (!Number.isInteger(input.budgetEgp) || input.budgetEgp < 0)) return { ok: false, error: "The budget is a whole number of EGP" };
  if (input.startedAt && input.endsAt && input.endsAt < input.startedAt) return { ok: false, error: "The end date is before the start" };
  const slug = input.slug?.trim() ? input.slug.trim().toLowerCase() : null;
  if (slug && !SLUG.test(slug)) return { ok: false, error: "The link name uses a-z, 0-9 and dashes (2 to 40)" };
  if (slug) {
    const [taken] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.slug, slug), id ? ne(campaigns.id, id) : undefined));
    if (taken) return { ok: false, error: `The link name "${slug}" is used by another campaign` };
  }
  const values = {
    label,
    kind: input.kind,
    status: input.status,
    sourceId: input.sourceId ?? null,
    startedAt: input.startedAt ?? null,
    endsAt: input.endsAt ?? null,
    eventAt: input.eventAt ?? null,
    budgetEgp: input.budgetEgp ?? null,
    slug,
    ownerId: input.ownerId ?? null,
    notes: input.notes?.trim() || null,
  };
  let rowId = id;
  if (id) {
    const r = await db.update(campaigns).set(values).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
    if (!r.length) return { ok: false, error: "Campaign not found" };
  } else {
    const [r] = await db.insert(campaigns).values({ ...values, startedAt: values.startedAt ?? new Date() }).returning({ id: campaigns.id });
    rowId = r.id;
  }
  await audit(db, { userId, entity: "campaign", entityId: rowId!, action: id ? "update" : "create" });
  return { ok: true, id: rowId! };
}

export type CampaignStats = {
  id: number;
  label: string;
  kind: CampaignKind;
  status: CampaignStatus;
  slug: string | null;
  source: string | null;
  startedAt: Date | null;
  endsAt: Date | null;
  eventAt: Date | null;
  budgetEgp: number | null;
  ownerId: number | null;
  notes: string | null;
  sourceId: number | null;
  leads: number;
  consulted: number; // leads with a held consult
  enrolled: number; // leads that enrolled
  revenueEgp: number;
  spendEgp: number; // costs Paid
  owedEgp: number; // costs Owed (committed, not paid yet)
  costPerLead: number | null;
  costPerEnrolment: number | null;
  roi: number | null; // (revenue − spend) ÷ spend
};

/** Every campaign with its funnel and money. One query, so the list stays fast. */
export async function campaignStats(db: Db, id?: number): Promise<CampaignStats[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with l as (select id, campaign_id from leads where deleted_at is null and campaign_id is not null ${id ? sql`and campaign_id = ${id}` : sql``})
    select g.id, g.label, g.kind, g.status, g.slug, s.label as source, g.source_id, g.started_at, g.ends_at, g.event_at, g.budget_egp, g.owner_id, g.notes,
      (select count(*) from l where l.campaign_id = g.id)::int as leads,
      (select count(*) from l where l.campaign_id = g.id and exists (select 1 from consults c where c.lead_id = l.id and c.held))::int as consulted,
      (select count(distinct e.lead_id) from enrolments e join l on l.id = e.lead_id where l.campaign_id = g.id)::int as enrolled,
      (select coalesce(sum(${dueFor("e")}), 0) from enrolments e join l on l.id = e.lead_id where l.campaign_id = g.id)::int as revenue,
      (select coalesce(sum(x.amount_egp), 0) from ledger_entries x where x.campaign_id = g.id and x.deleted_at is null and x.status = 'paid')::int as spend,
      (select coalesce(sum(x.amount_egp), 0) from ledger_entries x where x.campaign_id = g.id and x.deleted_at is null and x.status = 'owed')::int as owed
    from campaigns g left join sources s on s.id = g.source_id
    ${id ? sql`where g.id = ${id}` : sql``}
    order by (g.status = 'ended'), coalesce(g.event_at, g.started_at) desc nulls last, g.id desc`);
  return [...rows].map((r) => {
    const leads = Number(r.leads), enrolled = Number(r.enrolled), spend = Number(r.spend), revenue = Number(r.revenue);
    const d = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      id: Number(r.id),
      label: String(r.label),
      kind: r.kind as CampaignKind,
      status: r.status as CampaignStatus,
      slug: (r.slug as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      sourceId: r.source_id == null ? null : Number(r.source_id),
      startedAt: d(r.started_at),
      endsAt: d(r.ends_at),
      eventAt: d(r.event_at),
      budgetEgp: r.budget_egp == null ? null : Number(r.budget_egp),
      ownerId: r.owner_id == null ? null : Number(r.owner_id),
      notes: (r.notes as string | null) ?? null,
      leads,
      consulted: Number(r.consulted),
      enrolled,
      revenueEgp: revenue,
      spendEgp: spend,
      owedEgp: Number(r.owed),
      costPerLead: spend && leads ? Math.round(spend / leads) : null,
      costPerEnrolment: spend && enrolled ? Math.round(spend / enrolled) : null,
      roi: spend ? (revenue - spend) / spend : null,
    };
  });
}

/** The costs tagged to a campaign, newest first. */
export async function campaignCosts(db: Db, id: number) {
  return db
    .select({ id: ledgerEntries.id, entry: ledgerEntries.entry, amountEgp: ledgerEntries.amountEgp, status: ledgerEntries.status, date: ledgerEntries.date, category: ledgerEntries.category, createdAt: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.campaignId, id), isNull(ledgerEntries.deletedAt)))
    .orderBy(desc(sql`coalesce(${ledgerEntries.date}, ${ledgerEntries.createdAt})`));
}

export async function campaignBySlug(db: Db, slug: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.slug, slug.toLowerCase()));
  return row ?? null;
}

export const sourceList = (db: Db) => db.select().from(sources).orderBy(sources.label);
