import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { leads, referralRewards } from "@/db/schema";
import { audit } from "./audit";
import { saveEntry } from "./finance";

// Referrals: who brought whom. Rewards are decided by a person when a referred lead enrols; the amount is
// never pre-filled (the reward rules are the owners', QUESTIONS.md 29).

export const REWARD_STATUS = { pending: "To decide", approved: "Approved", paid: "Paid", declined: "Declined" } as const;
export type RewardStatus = keyof typeof REWARD_STATUS;

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const ascii = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "").slice(0, 10);

/** The person's code for ?ref= links, made the first time it is asked for: "hana-7k2p" (or "ref-7k2p"). */
export async function ensureReferralCode(db: Db, leadId: number): Promise<string | null> {
  const [l] = await db.select({ code: leads.referralCode, name: leads.fullName, deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, leadId));
  if (!l || l.deletedAt) return null;
  if (l.code) return l.code;
  const stem = ascii(l.name.split(/\s+/)[0] ?? "") || "ref";
  for (let i = 0; i < 6; i++) {
    const tail = Array.from(randomBytes(4), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    const rows = await db
      .update(leads)
      .set({ referralCode: `${stem}-${tail}` })
      .where(and(eq(leads.id, leadId), isNull(leads.referralCode), sql`not exists (select 1 from leads x where x.referral_code = ${`${stem}-${tail}`})`))
      .returning({ code: leads.referralCode });
    if (rows.length) return rows[0].code;
    const [again] = await db.select({ code: leads.referralCode }).from(leads).where(eq(leads.id, leadId));
    if (again?.code) return again.code;
  }
  return null;
}

/** Whose code it is; a code on a merged-away lead counts for the lead it was merged into. */
export async function referrerByCode(db: Pick<Db, "select">, code: string): Promise<number | null> {
  const c = code.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,30}$/.test(c)) return null;
  const [l] = await db.select({ id: leads.id, deletedAt: leads.deletedAt, mergedIntoId: leads.mergedIntoId }).from(leads).where(eq(leads.referralCode, c));
  if (!l) return null;
  if (!l.deletedAt) return l.id;
  return l.mergedIntoId ?? null;
}

export async function setReferrer(db: Db, leadId: number, referrerId: number | null, userId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (referrerId === leadId) return { ok: false, error: "Someone cannot refer themselves" };
  if (referrerId) {
    const [r] = await db.select({ deletedAt: leads.deletedAt, referredById: leads.referredById }).from(leads).where(eq(leads.id, referrerId));
    if (!r || r.deletedAt) return { ok: false, error: "No lead with that number" };
    if (r.referredById === leadId) return { ok: false, error: "They were referred by this lead: a referral cannot go both ways" };
  }
  const rows = await db.update(leads).set({ referredById: referrerId, updatedAt: new Date() }).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).returning({ id: leads.id });
  if (!rows.length) return { ok: false, error: "Lead not found" };
  await audit(db, { userId, entity: "lead", entityId: leadId, action: "referrer", diff: { referrerId } });
  return { ok: true };
}

/** A reward row for every referred lead that has enrolled and has none yet. Safe to call often. */
export async function syncRewards(db: Db) {
  await db.execute(sql`
    insert into referral_rewards (referrer_id, referred_lead_id)
    select l.referred_by_id, l.id from leads l
    where l.deleted_at is null and l.referred_by_id is not null and exists (select 1 from enrolments e where e.lead_id = l.id)
      and exists (select 1 from leads r where r.id = l.referred_by_id and r.deleted_at is null)
    on conflict (referred_lead_id) do nothing`);
}

export async function listReferrers(db: Db) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select r.id, r.full_name, r.referral_code,
      count(l.id)::int as referred,
      count(l.id) filter (where exists (select 1 from enrolments e where e.lead_id = l.id))::int as enrolled,
      coalesce((select sum(w.amount_egp) from referral_rewards w where w.referrer_id = r.id and w.status = 'paid'), 0)::int as paid_egp,
      (select count(*) from referral_rewards w where w.referrer_id = r.id and w.status = 'pending')::int as to_decide
    from leads r join leads l on l.referred_by_id = r.id and l.deleted_at is null
    where r.deleted_at is null
    group by r.id order by enrolled desc, referred desc, r.full_name`);
  return [...rows].map((r) => ({ id: Number(r.id), fullName: String(r.full_name), code: (r.referral_code as string | null) ?? null, referred: Number(r.referred), enrolled: Number(r.enrolled), paidEgp: Number(r.paid_egp), toDecide: Number(r.to_decide) }));
}

export async function listRewards(db: Db) {
  const referrer = alias(leads, "referrer");
  return db
    .select({ w: referralRewards, referrer: referrer.fullName, referred: leads.fullName })
    .from(referralRewards)
    .innerJoin(referrer, eq(referrer.id, referralRewards.referrerId))
    .innerJoin(leads, eq(leads.id, referralRewards.referredLeadId))
    .orderBy(sql`case ${referralRewards.status} when 'pending' then 0 when 'approved' then 1 else 2 end`, desc(referralRewards.createdAt));
}

/** Decide a reward. Approving needs an amount; paying records the cost in the ledger (once). */
export async function decideReward(db: Db, id: number, d: { status: RewardStatus; amountEgp?: number | null; note?: string | null }, userId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const [w] = await db
    .select({ w: referralRewards, referrer: leads.fullName })
    .from(referralRewards)
    .innerJoin(leads, eq(leads.id, referralRewards.referrerId))
    .where(eq(referralRewards.id, id));
  if (!w) return { ok: false, error: "Reward not found" };
  const amount = d.amountEgp ?? w.w.amountEgp;
  if ((d.status === "approved" || d.status === "paid") && !(amount && Number.isInteger(amount) && amount > 0)) return { ok: false, error: "Set the amount (EGP) to approve or pay a reward" };
  let ledgerEntryId = w.w.ledgerEntryId;
  if (d.status === "paid" && !ledgerEntryId) {
    const e = await saveEntry(db, null, { entry: `Referral reward: ${w.referrer}`, amountEgp: amount!, section: "variable_costs", category: "Referral rewards", status: "paid", notes: d.note ?? null }, userId);
    if (!e.ok) return e;
    ledgerEntryId = e.id;
  }
  await db
    .update(referralRewards)
    .set({ status: d.status, amountEgp: amount ?? null, note: d.note?.trim() || w.w.note, ledgerEntryId, decidedBy: userId, updatedAt: new Date() })
    .where(eq(referralRewards.id, id));
  await audit(db, { userId, entity: "referral_reward", entityId: id, action: d.status, diff: { amountEgp: amount ?? null } });
  return { ok: true };
}
