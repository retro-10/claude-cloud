import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, formSubmissions, leadForms, leads, sources } from "@/db/schema";
import { audit } from "./audit";
import { SLUG } from "./campaigns";
import { recordConsent } from "./consent";
import { createLead, findDuplicates, logActivity } from "./leads";
import { normalizePhone } from "./phone";

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"] as const;

// ---------------- managing forms ----------------

export type FormInput = {
  slug: string;
  title: string;
  intro?: string | null;
  thankYou?: string | null;
  campaignId?: number | null;
  sourceId?: number | null;
  askEmail: boolean;
  askCity: boolean;
  askSegment: boolean;
  askTier: boolean;
  active: boolean;
};
type Fail = { ok: false; error: string };

export async function saveForm(db: Db, id: number | null, f: FormInput, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  const slug = f.slug.trim().toLowerCase();
  if (!SLUG.test(slug)) return { ok: false, error: "The address uses a-z, 0-9 and dashes (2 to 40)" };
  const title = f.title.trim();
  if (!title || title.length > 120) return { ok: false, error: "Give the form a title (up to 120 characters)" };
  const [taken] = await db.select({ id: leadForms.id }).from(leadForms).where(eq(leadForms.slug, slug));
  if (taken && taken.id !== id) return { ok: false, error: `The address /f/${slug} is already used` };
  const values = {
    slug,
    title,
    intro: f.intro?.trim().slice(0, 2000) || null,
    thankYou: f.thankYou?.trim().slice(0, 1000) || null,
    campaignId: f.campaignId ?? null,
    sourceId: f.sourceId ?? null,
    askEmail: f.askEmail,
    askCity: f.askCity,
    askSegment: f.askSegment,
    askTier: f.askTier,
    active: f.active,
  };
  let rowId = id;
  if (id) {
    const r = await db.update(leadForms).set(values).where(eq(leadForms.id, id)).returning({ id: leadForms.id });
    if (!r.length) return { ok: false, error: "Form not found" };
  } else {
    const [r] = await db.insert(leadForms).values({ ...values, createdBy: userId }).returning({ id: leadForms.id });
    rowId = r.id;
  }
  await audit(db, { userId, entity: "lead_form", entityId: rowId!, action: id ? "update" : "create" });
  return { ok: true, id: rowId! };
}

export async function listForms(db: Db) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select f.*, g.label as campaign, s.label as source,
      (select count(*) from form_submissions x where x.form_id = f.id)::int as total,
      (select count(*) from form_submissions x where x.form_id = f.id and not x.existing)::int as new_leads,
      (select count(*) from form_submissions x where x.form_id = f.id and x.created_at > now() - interval '7 days')::int as week
    from lead_forms f left join campaigns g on g.id = f.campaign_id left join sources s on s.id = f.source_id
    order by f.active desc, f.id desc`);
  return [...rows].map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    title: String(r.title),
    intro: (r.intro as string | null) ?? null,
    thankYou: (r.thank_you as string | null) ?? null,
    campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
    sourceId: r.source_id == null ? null : Number(r.source_id),
    campaign: (r.campaign as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    askEmail: Boolean(r.ask_email),
    askCity: Boolean(r.ask_city),
    askSegment: Boolean(r.ask_segment),
    askTier: Boolean(r.ask_tier),
    active: Boolean(r.active),
    total: Number(r.total),
    newLeads: Number(r.new_leads),
    week: Number(r.week),
  }));
}
export type FormRow = Awaited<ReturnType<typeof listForms>>[number];

export async function activeForm(db: Db, slug: string) {
  const [f] = await db.select().from(leadForms).where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true)));
  return f ?? null;
}

// ---------------- anti-spam: a signed "form shown at" stamp, and a keyed hash of the address ----------------

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters");
  return s;
}
/** Put in the page as a hidden field; a bot that posts without loading the page, or within 2 seconds, fails. */
export function formStamp(formId: number, now = Date.now()) {
  const sig = createHmac("sha256", key()).update(`form:${formId}:${now}`).digest("base64url").slice(0, 22);
  return `${now}.${sig}`;
}
export function checkStamp(formId: number, stamp: string, now = Date.now()): "ok" | "too_fast" | "expired" | "bad" {
  const [t, sig] = stamp.split(".");
  const at = Number(t);
  if (!Number.isFinite(at) || !sig) return "bad";
  const want = createHmac("sha256", key()).update(`form:${formId}:${at}`).digest("base64url").slice(0, 22);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return "bad";
  if (now - at < 2000) return "too_fast";
  if (now - at > 6 * 3600_000) return "expired";
  return "ok";
}
export const hashIp = (ip: string) => createHash("sha256").update(`ip:${key()}:${ip}`).digest("hex").slice(0, 24);

// ---------------- intake: the public form and the webhook both come through here ----------------

export type IntakeInput = {
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  segment?: "fresh_graduate" | "technician" | "dentist" | "other" | null;
  tier?: "foundation" | "freelance_ready" | "production_partner" | "unsure" | null;
  consent: boolean;
  attribution: Record<string, string>;
  formId?: number | null;
  campaignId?: number | null;
  sourceId?: number | null;
  sourceLabel?: string | null; // the webhook names a source by label
  channel: "form" | "webhook";
  ipHash?: string | null;
};
export type IntakeResult = { ok: true; leadId: number; existing: boolean } | { ok: false; error: "name" | "phone" | "email" };

const clip = (v: string | null | undefined, n: number) => (v && v.trim() ? v.trim().slice(0, n) : null);

/** Keep only known tracking keys, short and printable. */
export function cleanAttribution(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100);
  }
  return out;
}

async function sourceIdByLabel(db: Db, label: string) {
  const l = label.trim().slice(0, 80);
  await db.insert(sources).values({ label: l }).onConflictDoNothing();
  const [r] = await db.select({ id: sources.id }).from(sources).where(eq(sources.label, l));
  return r.id;
}

export async function intake(db: Db, i: IntakeInput): Promise<IntakeResult> {
  const name = clip(i.name, 120);
  if (!name) return { ok: false, error: "name" };
  const phone = normalizePhone(i.phone ?? "");
  if (!phone) return { ok: false, error: "phone" };
  const email = clip(i.email, 200)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email" };

  // campaign: the form's own, else the link's utm_campaign when it names one of ours
  let campaignId = i.campaignId ?? null;
  let campaignSource: number | null = null;
  if (!campaignId && i.attribution.utm_campaign) {
    const [g] = await db.select({ id: campaigns.id, sourceId: campaigns.sourceId }).from(campaigns).where(eq(campaigns.slug, i.attribution.utm_campaign.toLowerCase()));
    if (g) [campaignId, campaignSource] = [g.id, g.sourceId];
  } else if (campaignId) {
    const [g] = await db.select({ sourceId: campaigns.sourceId }).from(campaigns).where(eq(campaigns.id, campaignId));
    campaignSource = g?.sourceId ?? null;
  }
  const sourceId = i.sourceId ?? campaignSource ?? (await sourceIdByLabel(db, i.sourceLabel || (i.channel === "webhook" ? "Ads form" : "Website form")));
  const attribution = { ...i.attribution, ...(i.formId ? { form: String(i.formId) } : {}) };

  // someone we already know: link the sign-up to them, never a duplicate, and never say so on the page
  const dupes = await findDuplicates(db, { phone, email });
  const known = dupes.find((d) => !d.deleted) ?? null;
  let leadId: number;
  let existing = false;
  if (known) {
    leadId = known.id;
    existing = true;
    const [l] = await db.select({ campaignId: leads.campaignId }).from(leads).where(eq(leads.id, leadId));
    if (!l.campaignId && campaignId) await db.update(leads).set({ campaignId, updatedAt: new Date() }).where(eq(leads.id, leadId));
    await logActivity(db, { leadId, type: "note", direction: "internal", body: `Signed up again${i.formId ? " on a form" : " through the ads webhook"}${campaignId ? " for a campaign" : ""}.`, runRules: false }, null);
  } else {
    const r = await createLead(
      db,
      { fullName: name, phone, email, city: clip(i.city, 80), segment: i.segment ?? null, tierInterest: i.tier ?? "unsure", sourceId, campaignId, attribution },
      null,
      { allowNameMatch: true },
    );
    if (!r.ok) {
      if (r.error === "invalid_phone") return { ok: false, error: "phone" };
      // a deleted lead still holds this phone or email: attach to it rather than fail the person
      const d = r.error === "duplicate" ? r.duplicates[0] : null;
      if (!d) return { ok: false, error: "phone" };
      leadId = d.id;
      existing = true;
    } else leadId = r.lead.id;
  }
  if (i.consent) await recordConsent(db, { leadId, granted: true, method: "form" }, null);
  await db.insert(formSubmissions).values({ formId: i.formId ?? null, leadId, existing, channel: i.channel, ipHash: i.ipHash ?? null });
  return { ok: true, leadId, existing };
}

export async function recentSubmissions(db: Db, formId: number, limit = 50) {
  return db
    .select({ id: formSubmissions.id, leadId: formSubmissions.leadId, existing: formSubmissions.existing, createdAt: formSubmissions.createdAt, fullName: leads.fullName })
    .from(formSubmissions)
    .innerJoin(leads, eq(leads.id, formSubmissions.leadId))
    .where(eq(formSubmissions.formId, formId))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(limit);
}
