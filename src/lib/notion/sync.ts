import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { appSettings, cohorts, enrolments, ledgerEntries, leads, notionLinks, notionSyncRuns, programmeSessions, proofItems, sources, stages, teamMembers, users } from "@/db/schema";
import { audit } from "../audit";
import { SECTIONS, saveEntry, type Section, type Status } from "../finance";
import { normalizePhone } from "../phone";
import { LIST_PRICE_EGP, TIER_LABEL } from "../pricing";
import { cairoLocalToDate, cairoYmd } from "../time";
import { NotionError, NotionHttp, get, pid, put, type NotionApi, type Page, type Props } from "./client";

// Two-way sync between the CRM (Postgres) and the camp's Notion workspace.
//
//   CRM            Notion
//   cohorts    <-> Batches      (name, seats, dates, status; enrolled counts are written by the CRM)
//   enrolments <-> Candidates   (tier, plan, status, discount, installment dates, notes, contact details)
//   ledger     <-> Ledger       (every field except the CRM-only payment reference)
//   leads       -> CRM Leads    (a database the sync creates; only name, email and notes come back)
//
// Each synced row has a notion_links row: the page it belongs to, a hash of the field values both sides
// agreed on, and the local updated_at at that moment. A run pulls pages edited in Notion since the last
// run, then pushes rows changed in the CRM. When both sides changed the same row since the last run,
// the newer edit wins and the run counts a conflict. Nothing is ever hard-deleted: a ledger page archived
// in Notion soft-deletes the entry; any other archived page is unlinked and reported.

export type NotionConfig = {
  token: string;
  batchesDb: string;
  candidatesDb: string;
  ledgerDb: string;
  parentPage: string;
  sessionsDb: string;
  proofDb: string;
  teamDb: string;
  leadsDb: string | null; // null: created on the first run under parentPage
  syncLeads: boolean;
  appUrl: string | null;
};

export function notionConfig(env: Record<string, string | undefined> = process.env): NotionConfig | null {
  const token = env.NOTION_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    batchesDb: env.NOTION_BATCHES_DB || "c3e0b4ef-e18f-48c6-9eec-aeb3e1f4d951",
    candidatesDb: env.NOTION_CANDIDATES_DB || "ed8f45c4-e790-42e4-a0fe-841d14cbbc42",
    ledgerDb: env.NOTION_LEDGER_DB || "117399e6-dbad-4d65-ac2c-96f018aebc7e",
    parentPage: env.NOTION_PARENT_PAGE || "3e45624a-2246-81e5-9dfc-dd61a4550e7c",
    sessionsDb: env.NOTION_SESSIONS_DB || "1ade3ea7-6c29-4022-9dd7-5d26187b00bf",
    proofDb: env.NOTION_PROOF_DB || "a4df71c2-181d-46f9-9bbb-83300ed75379",
    teamDb: env.NOTION_TEAM_DB || "7e7b2eb3-c2f3-44e1-9104-c4cb814c0f70",
    leadsDb: env.NOTION_LEADS_DB || null,
    syncLeads: env.NOTION_SYNC_LEADS !== "false",
    appUrl: env.APP_URL?.replace(/\/$/, "") || (env.DOMAIN ? `https://${env.DOMAIN}` : null),
  };
}

type Entity = "cohort" | "enrolment" | "team" | "ledger" | "session" | "proof" | "lead";
type Fields = Record<string, string | number | boolean | null>;
type Link = { id: number; entity: string; localId: number; pageId: string; hash: string | null; syncedAt: Date; notionEditedAt: Date | null };
type Local = { f: Fields; updatedAt: Date; deleted: boolean };

const GONE = "gone"; // link hash for a page that was deleted in Notion: never pushed again
const MAX_WRITES = 250; // per run, so a first sync of thousands of leads spreads over several runs
const STATE_KEY = "notion_state";

type State = { leadsDb?: string; cursors?: Partial<Record<Entity, string>>; version?: number };
// Raise when the synced fields change: the next run then reads every page first, so values Notion already
// has for the new fields come in instead of being overwritten by the CRM's empty defaults.
const SYNC_VERSION = 2;

export type RunResult = { pushed: number; pulled: number; created: number; conflicts: number; errors: string[]; more: boolean };

class Ctx {
  byPage = new Map<string, Link>();
  byLocal = new Map<string, Link>();
  writes = 0;
  r: RunResult = { pushed: 0, pulled: 0, created: 0, conflicts: 0, errors: [], more: false };
  constructor(
    readonly db: Db,
    readonly api: NotionApi,
    readonly cfg: NotionConfig,
  ) {}
  pageOf(e: Entity, id: number | null | undefined) {
    if (!id) return null;
    const l = this.byLocal.get(`${e}:${id}`);
    return l && l.hash !== GONE ? l.pageId : null;
  }
  localOf(e: Entity, page: string | undefined) {
    const l = page ? this.byPage.get(pid(page)) : undefined;
    return l && l.entity === e ? l.localId : null;
  }
  error(msg: string) {
    if (this.r.errors.length < 50) this.r.errors.push(msg);
  }
  async saveLink(e: Entity, localId: number, pageId: string, v: { hash: string; syncedAt: Date; notionEditedAt?: string | null }) {
    const values = {
      entity: e,
      localId,
      pageId: pid(pageId),
      hash: v.hash,
      syncedAt: v.syncedAt,
      notionEditedAt: v.notionEditedAt ? new Date(v.notionEditedAt) : null,
    };
    const [row] = await this.db
      .insert(notionLinks)
      .values(values)
      .onConflictDoUpdate({ target: [notionLinks.entity, notionLinks.localId], set: { pageId: values.pageId, hash: values.hash, syncedAt: values.syncedAt, notionEditedAt: values.notionEditedAt } })
      .returning();
    const old = this.byLocal.get(`${e}:${localId}`);
    if (old) this.byPage.delete(old.pageId);
    this.byLocal.set(`${e}:${localId}`, row);
    this.byPage.set(row.pageId, row);
  }
}

export const hashFields = (f: Fields) =>
  createHash("sha256")
    .update(JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]])))
    .digest("hex")
    .slice(0, 32);

const ymd = (d: Date | null | undefined) => (d ? cairoYmd(d) : null);
/** Keep the time of day of an existing timestamp when only the date is synced. */
const dateFrom = (v: string | null, old: Date | null, hour = "12:00") => (!v ? null : old && cairoYmd(old) === v ? old : cairoLocalToDate(`${v}T${hour}`));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const invert = <K extends string>(m: Record<K, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k])) as Record<string, K>;

const COHORT_STATUS = { planning: "Planning", live: "Live", closed: "Closed" } as const;
const PLAN = { one_time: "One-time", installments: "Installments", free_seat: "Free seat" } as const;
const STUDENT = { active: "Active", graduated: "Graduated", dropped: "Dropped" } as const;
const SECTION_LABEL = Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.label])) as Record<Section, string>;
const STATUS = { received: "Received", expected: "Expected", paid: "Paid", owed: "Owed", cancelled: "Cancelled" } as const;
const TIERS = TIER_LABEL as Record<keyof typeof LIST_PRICE_EGP, string>;

/** Phone as Notion's "Number" column holds it: the E.164 digits without the plus. */
const phoneNumber = (e164: string | null) => (e164 ? Number(e164.replace(/\D/g, "")) : null);
// A number column drops the leading 0 and the +: 201012345678 (with country code) or 1012345678 (Egyptian, typed locally)
const phoneFrom = (n: number | null) => {
  if (!n) return null;
  const d = String(Math.round(n));
  return normalizePhone(d.startsWith("20") && d.length === 12 ? `+${d}` : d);
};

type Spec = {
  entity: Entity;
  database: (c: Ctx) => string | null;
  /** Local ids that may need a push: not linked yet, or changed since the last sync. */
  pending: (c: Ctx) => Promise<number[]>;
  load: (c: Ctx, ids: number[]) => Promise<Map<number, Local>>;
  fromPage: (c: Ctx, p: Page) => Fields | string;
  toProps: (c: Ctx, f: Fields) => Props;
  /** Write Notion's values into the CRM. id null = the page is new in Notion. Returns the local id or a problem. */
  apply: (c: Ctx, id: number | null, f: Fields) => Promise<number | string>;
  /** An existing CRM row that a new Notion page describes (first sync), so nothing is duplicated. */
  match?: (c: Ctx, f: Fields) => Promise<number | null>;
  /** What happens when the page was deleted in Notion. */
  onGone?: (c: Ctx, id: number) => Promise<void>;
  label: (f: Fields) => string;
  /** Notion is the only writer (the CRM mirrors it): never pushed. */
  readOnly?: boolean;
};

// ---------------- Batches ----------------

const cohortSpec: Spec = {
  entity: "cohort",
  database: (c) => c.cfg.batchesDb,
  label: (f) => `Batch "${f.name}"`,
  // batches are few and their enrolled counts change with enrolments, so every batch is checked (by hash)
  pending: async (c) => (await c.db.select({ id: cohorts.id }).from(cohorts).orderBy(cohorts.id)).map((r) => r.id),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db
      .select({
        c: cohorts,
        enrolled: sql<number>`(select count(*) from enrolments e where e.cohort_id = "cohorts"."id")::int`,
        foundation: sql<number>`(select count(*) from enrolments e where e.cohort_id = "cohorts"."id" and e.tier = 'foundation')::int`,
        freelance: sql<number>`(select count(*) from enrolments e where e.cohort_id = "cohorts"."id" and e.tier = 'freelance_ready')::int`,
        production: sql<number>`(select count(*) from enrolments e where e.cohort_id = "cohorts"."id" and e.tier = 'production_partner')::int`,
      })
      .from(cohorts)
      .where(inArray(cohorts.id, ids));
    return new Map(
      rows.map((r) => [
        r.c.id,
        {
          updatedAt: r.c.updatedAt,
          deleted: false,
          f: {
            name: r.c.name,
            seats: r.c.seatCap,
            open: ymd(r.c.openAt),
            close: ymd(r.c.enrolmentCloseAt),
            status: r.c.status,
            enrolled: Number(r.enrolled),
            foundation: Number(r.foundation),
            freelance: Number(r.freelance),
            production: Number(r.production),
          },
        },
      ]),
    );
  },
  fromPage: (_c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    return {
      name,
      seats: int(get.number(P["Seats"])),
      open: get.date(P["Open date"]),
      close: get.date(P["Close date"]),
      status: invert(COHORT_STATUS)[get.select(P["Status"]) ?? ""] ?? "planning",
      enrolled: int(get.number(P["Enrolled"])),
      foundation: int(get.number(P["Foundation enrolled"])),
      freelance: int(get.number(P["Freelance Ready enrolled"])),
      production: int(get.number(P["Production Partner enrolled"])),
    };
  },
  toProps: (_c, f) => ({
    Name: put.title(f.name as string),
    Seats: put.number(f.seats as number),
    "Open date": put.date(f.open as string | null),
    "Close date": put.date(f.close as string | null),
    Status: put.select(COHORT_STATUS[f.status as keyof typeof COHORT_STATUS]),
    Enrolled: put.number(f.enrolled as number),
    "Foundation enrolled": put.number(f.foundation as number),
    "Freelance Ready enrolled": put.number(f.freelance as number),
    "Production Partner enrolled": put.number(f.production as number),
  }),
  apply: async (c, id, f) => {
    const [old] = id ? await c.db.select().from(cohorts).where(eq(cohorts.id, id)) : [];
    const used = id ? Number((await c.db.select({ n: sql<number>`count(*)::int` }).from(enrolments).where(eq(enrolments.cohortId, id)))[0].n) : 0;
    // Seats is the real QC capacity: never below the seats already taken, 40 when Notion leaves it empty
    const seats = Math.max(used, int(f.seats) ?? old?.seatCap ?? 40, 1);
    const values = {
      name: String(f.name).slice(0, 200),
      seatCap: seats,
      openAt: dateFrom(str(f.open), old?.openAt ?? null, "00:00"),
      enrolmentCloseAt: dateFrom(str(f.close), old?.enrolmentCloseAt ?? null, "23:59"),
      status: f.status as keyof typeof COHORT_STATUS,
      updatedAt: new Date(),
    };
    if (id) {
      await c.db.update(cohorts).set(values).where(eq(cohorts.id, id));
      await audit(c.db, { userId: null, entity: "cohort", entityId: id, action: "notion_pull" });
      return id;
    }
    const [row] = await c.db.insert(cohorts).values(values).returning({ id: cohorts.id });
    await audit(c.db, { userId: null, entity: "cohort", entityId: row.id, action: "notion_create" });
    return row.id;
  },
  match: async (c, f) => {
    const [row] = await c.db.select({ id: cohorts.id }).from(cohorts).where(sql`lower(${cohorts.name}) = lower(${String(f.name)})`);
    return row?.id ?? null;
  },
};

// ---------------- Candidates ----------------

const candidateSpec: Spec = {
  entity: "enrolment",
  database: (c) => c.cfg.candidatesDb,
  label: (f) => `Candidate "${f.name}"`,
  pending: async (c) =>
    (
      await c.db.execute<{ id: number }>(sql`
        select e.id from enrolments e join leads l on l.id = e.lead_id
        left join notion_links n on n.entity = 'enrolment' and n.local_id = e.id
        where n.id is null or (n.hash is distinct from ${GONE} and greatest(e.updated_at, l.updated_at) > n.synced_at)
        order by e.id limit 2000`)
    ).map((r) => Number(r.id)),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db.select({ e: enrolments, l: leads }).from(enrolments).innerJoin(leads, eq(leads.id, enrolments.leadId)).where(inArray(enrolments.id, ids));
    return new Map(
      rows.map(({ e, l }) => [
        e.id,
        {
          updatedAt: e.updatedAt > l.updatedAt ? e.updatedAt : l.updatedAt,
          deleted: false,
          f: {
            name: l.fullName,
            email: l.email,
            phone: l.phoneWhatsapp,
            batch: e.cohortId,
            tier: e.tier,
            plan: e.paymentPlan,
            status: e.status,
            discount: e.discountEgp,
            first: ymd(e.firstInstalmentAt),
            final: ymd(e.finalInstalmentAt),
            applied: ymd(l.createdAt),
            notes: e.notes,
            consent: e.contentConsent,
            scope: [...e.contentConsentScope].sort().join(","),
            qc: e.qcScore === null ? null : Math.round(e.qcScore * 100) / 100,
            rank: e.leaderboardRank,
          },
        },
      ]),
    );
  },
  fromPage: (c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    const tier = invert(TIERS)[get.select(P["Tier"]) ?? ""];
    if (!tier) return "has no Tier";
    const batchPage = get.relation(P["Batch"])[0];
    const batch = c.localOf("cohort", batchPage);
    if (!batch) return batchPage ? "is in a batch the CRM does not know yet" : "has no Batch";
    return {
      name,
      email: get.text(P["Gmail"]),
      phone: phoneFrom(get.number(P["Number"])),
      batch,
      tier,
      plan: invert(PLAN)[get.select(P["Payment plan"]) ?? ""] ?? "one_time",
      status: invert(STUDENT)[get.select(P["Status"]) ?? ""] ?? "active",
      discount: Math.max(0, int(get.number(P["Discount (EGP)"])) ?? 0),
      first: get.date(P["First installment date"]),
      final: get.date(P["Final installment date"]),
      applied: get.date(P["Date applied"]),
      notes: get.text(P["Notes"]),
      consent: get.checkbox(P["Consent on file?"]),
      scope: get.multi(P["Consent scope"]),
      qc: (() => {
        const q = get.number(P["QC score"]);
        return q === null ? null : Math.round(q * 100) / 100;
      })(),
      rank: int(get.number(P["Leaderboard rank"])),
    };
  },
  toProps: (c, f) => ({
    Name: put.title(f.name as string),
    Gmail: put.text(f.email as string | null),
    Number: put.number(phoneNumber(f.phone as string | null)),
    Batch: put.relation([c.pageOf("cohort", f.batch as number)]),
    Tier: put.select(TIERS[f.tier as keyof typeof TIERS]),
    "Payment plan": put.select(PLAN[f.plan as keyof typeof PLAN]),
    Status: put.select(STUDENT[f.status as keyof typeof STUDENT]),
    "Discount (EGP)": put.number(f.discount as number),
    "First installment date": put.date(f.first as string | null),
    "Final installment date": put.date(f.final as string | null),
    "Date applied": put.date(f.applied as string | null),
    Notes: put.text(f.notes as string | null),
    "Consent on file?": put.checkbox(!!f.consent),
    "Consent scope": put.multi(f.scope as string),
    "QC score": put.number(f.qc as number | null),
    "Leaderboard rank": put.number(f.rank as number | null),
  }),
  apply: async (c, id, f) => {
    const tier = f.tier as keyof typeof LIST_PRICE_EGP;
    const now = new Date();
    return c.db.transaction(async (tx) => {
      let enrolmentId = id;
      let leadId: number;
      if (id) {
        const [e] = await tx.select().from(enrolments).where(eq(enrolments.id, id));
        if (!e) return "was removed from the CRM";
        leadId = e.leadId;
        const moveTo = f.batch as number;
        if (moveTo !== e.cohortId) {
          const [clash] = await tx.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.leadId, e.leadId), eq(enrolments.cohortId, moveTo)));
          if (clash) return "is already enrolled in that batch";
        }
        await tx
          .update(enrolments)
          .set({
            cohortId: moveTo,
            tier,
            // Notion has no price column (its Tier price is a formula), so a tier change takes the list price
            amountEgp: tier === e.tier ? e.amountEgp : LIST_PRICE_EGP[tier],
            discountEgp: f.discount as number,
            paymentPlan: f.plan as keyof typeof PLAN,
            status: f.status as keyof typeof STUDENT,
            firstInstalmentAt: dateFrom(str(f.first), e.firstInstalmentAt),
            finalInstalmentAt: dateFrom(str(f.final), e.finalInstalmentAt),
            notes: str(f.notes),
            contentConsent: !!f.consent,
            contentConsentScope: String(f.scope ?? "").split(",").filter(Boolean),
            qcScore: f.qc as number | null,
            leaderboardRank: f.rank as number | null,
            updatedAt: now,
          })
          .where(eq(enrolments.id, id));
      } else {
        // a candidate added in Notion: find the lead by phone or email, or create one already enrolled
        const phone = f.phone as string | null;
        const email = str(f.email);
        const [found] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(
            sql`${leads.deletedAt} is null and (${phone ? sql`${leads.phoneWhatsapp} = ${phone}` : sql`false`} or ${email ? sql`lower(${leads.email}) = lower(${email})` : sql`false`})`,
          )
          .limit(1);
        if (found) leadId = found.id;
        else {
          await tx.insert(sources).values({ label: "Notion" }).onConflictDoNothing();
          const [src] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.label, "Notion"));
          const [won] = await tx.select({ key: stages.key }).from(stages).where(eq(stages.kind, "won")).limit(1);
          const [l] = await tx
            .insert(leads)
            .values({
              fullName: String(f.name).slice(0, 200),
              phoneWhatsapp: phone,
              email,
              sourceId: src?.id ?? null,
              stage: won?.key ?? "enrolled",
              tierInterest: tier,
              closedAt: now,
              createdAt: str(f.applied) ? (cairoLocalToDate(`${f.applied}T12:00`) ?? now) : now,
              updatedAt: now,
            })
            .returning({ id: leads.id });
          leadId = l.id;
          await audit(tx, { userId: null, entity: "lead", entityId: leadId, action: "notion_create" });
        }
        const [dupe] = await tx.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.leadId, leadId), eq(enrolments.cohortId, f.batch as number)));
        if (dupe) enrolmentId = dupe.id;
        else {
          const [e] = await tx
            .insert(enrolments)
            .values({
              leadId,
              cohortId: f.batch as number,
              tier,
              amountEgp: LIST_PRICE_EGP[tier],
              discountEgp: f.discount as number,
              paymentPlan: f.plan as keyof typeof PLAN,
              status: f.status as keyof typeof STUDENT,
              firstInstalmentAt: dateFrom(str(f.first), null),
              finalInstalmentAt: dateFrom(str(f.final), null),
              notes: str(f.notes),
              contentConsent: !!f.consent,
              contentConsentScope: String(f.scope ?? "").split(",").filter(Boolean),
              qcScore: f.qc as number | null,
              leaderboardRank: f.rank as number | null,
              updatedAt: now,
            })
            .returning({ id: enrolments.id });
          enrolmentId = e.id;
        }
      }
      // contact details: a phone that belongs to another lead is left alone (merge them in the CRM)
      const [l] = await tx.select().from(leads).where(eq(leads.id, leadId));
      const set: Partial<typeof leads.$inferInsert> = {};
      if (f.name !== l.fullName) set.fullName = String(f.name).slice(0, 200);
      if (str(f.email) !== l.email) set.email = str(f.email);
      const phone = f.phone as string | null;
      if (phone && phone !== l.phoneWhatsapp) {
        const [taken] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phoneWhatsapp, phone));
        if (!taken) set.phoneWhatsapp = phone;
      }
      if (Object.keys(set).length) {
        await tx.update(leads).set({ ...set, updatedAt: now }).where(eq(leads.id, leadId));
        await audit(tx, { userId: null, entity: "lead", entityId: leadId, action: "notion_pull", diff: { fields: Object.keys(set) } });
      }
      await audit(tx, { userId: null, entity: "enrolment", entityId: enrolmentId!, action: id ? "notion_pull" : "notion_create" });
      return enrolmentId!;
    });
  },
  match: async (c, f) => {
    const phone = f.phone as string | null;
    const email = str(f.email);
    const [row] = await c.db
      .select({ id: enrolments.id })
      .from(enrolments)
      .innerJoin(leads, eq(leads.id, enrolments.leadId))
      .where(
        sql`${enrolments.cohortId} = ${f.batch as number} and (${phone ? sql`${leads.phoneWhatsapp} = ${phone}` : sql`false`}
          or ${email ? sql`lower(${leads.email}) = lower(${email})` : sql`false`} or lower(${leads.fullName}) = lower(${String(f.name)}))`,
      )
      .limit(1);
    return row?.id ?? null;
  },
};

// ---------------- Ledger ----------------

const ledgerSpec: Spec = {
  entity: "ledger",
  database: (c) => c.cfg.ledgerDb,
  label: (f) => `Ledger "${f.entry}"`,
  pending: async (c) =>
    (
      await c.db.execute<{ id: number }>(sql`
        select x.id from ledger_entries x left join notion_links n on n.entity = 'ledger' and n.local_id = x.id
        where (n.id is null and x.deleted_at is null) or (n.id is not null and n.hash is distinct from ${GONE} and x.updated_at > n.synced_at)
        order by x.id limit 2000`)
    ).map((r) => Number(r.id)),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db.select().from(ledgerEntries).where(inArray(ledgerEntries.id, ids));
    return new Map(
      rows.map((x) => [
        x.id,
        {
          updatedAt: x.updatedAt,
          deleted: !!x.deletedAt,
          f: {
            entry: x.entry,
            amount: x.amountEgp,
            date: ymd(x.date),
            approx: x.dateApproximate,
            section: x.section,
            category: x.category,
            status: x.status,
            partner: x.partner,
            fromTo: x.fromTo,
            notes: x.notes,
            candidate: x.enrolmentId,
            batch: x.cohortId,
            team: x.teamMemberId,
          },
        },
      ]),
    );
  },
  fromPage: (c, p) => {
    const P = p.properties;
    const entry = get.text(P["Entry"]);
    if (!entry) return "has no Entry name";
    const section = invert(SECTION_LABEL)[get.select(P["Section"]) ?? ""];
    if (!section) return "has no Section";
    const status = invert(STATUS)[get.select(P["Status"]) ?? ""];
    if (!status) return "has no Status";
    // a relation to a page the CRM has not linked yet would silently drop the link: skip until it is known
    const candPage = get.relation(P["Candidate"])[0];
    const candidate = c.localOf("enrolment", candPage);
    if (candPage && !candidate) return "is linked to a candidate the CRM does not know yet";
    const batchPage = get.relation(P["Batch"])[0];
    const batch = c.localOf("cohort", batchPage);
    if (batchPage && !batch) return "is linked to a batch the CRM does not know yet";
    const teamPage = get.relation(P["Team member"])[0];
    const team = c.localOf("team", teamPage);
    if (teamPage && !team) return "is linked to a team member the CRM does not know yet";
    return {
      entry,
      amount: int(get.number(P["Amount (EGP)"])),
      date: get.date(P["Date"]),
      approx: get.checkbox(P["Date approximate"]),
      section,
      category: get.select(P["Category"]),
      status,
      partner: section === "partner_withdrawals" ? get.select(P["Partner"]) : null,
      fromTo: get.text(P["From / to"]),
      notes: get.text(P["Notes"]),
      candidate,
      batch,
      team,
    };
  },
  toProps: (c, f) => ({
    Entry: put.title(f.entry as string),
    "Amount (EGP)": put.number(f.amount as number),
    Date: put.date(f.date as string | null),
    "Date approximate": put.checkbox(!!f.approx),
    Section: put.select(SECTION_LABEL[f.section as Section]),
    Category: put.select(f.category as string),
    Status: put.select(STATUS[f.status as Status]),
    Partner: put.select(f.section === "partner_withdrawals" ? (f.partner as string | null) : null),
    "From / to": put.text(f.fromTo as string | null),
    Notes: put.text(f.notes as string | null),
    Candidate: put.relation([c.pageOf("enrolment", f.candidate as number | null)]),
    Batch: put.relation([c.pageOf("cohort", f.batch as number | null)]),
    "Team member": put.relation([c.pageOf("team", f.team as number | null)]),
  }),
  apply: async (c, id, f) => {
    const [old] = id ? await c.db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)) : [];
    const r = await saveEntry(
      c.db,
      id,
      {
        entry: String(f.entry),
        amountEgp: (f.amount as number | null) ?? 0,
        date: dateFrom(str(f.date), old?.date ?? null),
        dateApproximate: !!f.approx,
        section: f.section as Section,
        category: str(f.category) ?? "",
        status: f.status as Status,
        partner: f.partner as string | null,
        fromTo: f.fromTo as string | null,
        notes: f.notes as string | null,
        reference: old?.reference ?? null, // CRM-only
        enrolmentId: (f.candidate as number | null) ?? null,
        cohortId: (f.batch as number | null) ?? null,
        teamMemberId: (f.team as number | null) ?? null,
      },
      null,
    );
    return r.ok ? r.id : r.error;
  },
  match: async (c, f) => {
    if (!f.amount) return null;
    const [row] = await c.db.execute<{ id: number }>(sql`
      select x.id from ledger_entries x left join notion_links n on n.entity = 'ledger' and n.local_id = x.id
      where n.id is null and x.deleted_at is null and x.amount_egp = ${f.amount as number} and x.section = ${f.section as string}
        and x.category = ${String(f.category ?? "")} and ${f.date ? sql`to_char(x.date at time zone 'Africa/Cairo', 'YYYY-MM-DD') = ${f.date as string}` : sql`x.date is null`}
        and x.enrolment_id is not distinct from ${(f.candidate as number | null) ?? null}
      order by x.id limit 1`);
    return row ? Number(row.id) : null;
  },
  onGone: async (c, id) => {
    await c.db.update(ledgerEntries).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(ledgerEntries.id, id));
    await audit(c.db, { userId: null, entity: "ledger", entityId: id, action: "notion_delete" });
  },
};

// ---------------- Leads (a database the sync creates) ----------------

const leadSpec: Spec = {
  entity: "lead",
  database: (c) => c.cfg.leadsDb,
  label: (f) => `Lead "${f.name}"`,
  pending: async (c) =>
    (
      await c.db.execute<{ id: number }>(sql`
        select l.id from leads l left join notion_links n on n.entity = 'lead' and n.local_id = l.id
        where (n.id is null and l.deleted_at is null) or (n.id is not null and n.hash is distinct from ${GONE} and l.updated_at > n.synced_at)
        order by l.id limit 2000`)
    ).map((r) => Number(r.id)),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db
      .select({ l: leads, stage: stages.label, owner: users.name, source: sources.label })
      .from(leads)
      .leftJoin(stages, eq(stages.key, leads.stage))
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(sources, eq(sources.id, leads.sourceId))
      .where(inArray(leads.id, ids));
    return new Map(
      rows.map(({ l, stage, owner, source }) => [
        l.id,
        {
          updatedAt: l.updatedAt,
          deleted: !!l.deletedAt,
          f: {
            name: l.fullName,
            email: l.email,
            notes: l.notes,
            phone: l.phoneWhatsapp,
            stage: stage ?? l.stage,
            owner: owner ?? null,
            source: source ?? null,
            segment: l.segment,
            tier: l.tierInterest,
            created: ymd(l.createdAt),
            decision: ymd(l.decisionDueAt),
            crm: c.cfg.appUrl ? `${c.cfg.appUrl}/leads/${l.id}` : null,
          },
        },
      ]),
    );
  },
  fromPage: (_c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    return {
      name,
      email: get.email(P["Email"]),
      notes: get.text(P["Notes"]),
      phone: get.phone(P["Phone"]),
      stage: get.select(P["Stage"]),
      owner: get.select(P["Owner"]),
      source: get.select(P["Source"]),
      segment: get.select(P["Segment"]),
      tier: get.select(P["Tier interest"]),
      created: get.date(P["Created"]),
      decision: get.date(P["Decision due"]),
      crm: (P["Open in CRM"]?.url as string | null | undefined) ?? null,
    };
  },
  toProps: (_c, f) => ({
    Name: put.title(f.name as string),
    Email: put.email(f.email as string | null),
    Notes: put.text(f.notes as string | null),
    Phone: put.phone(f.phone as string | null),
    Stage: put.select(f.stage as string | null),
    Owner: put.select(f.owner as string | null),
    Source: put.select(f.source as string | null),
    Segment: put.select(f.segment as string | null),
    "Tier interest": put.select(f.tier as string | null),
    Created: put.date(f.created as string | null),
    "Decision due": put.date(f.decision as string | null),
    "Open in CRM": put.url(f.crm as string | null),
  }),
  // only the name, email and notes come back; stage, owner and the rest are changed in the CRM
  apply: async (c, id, f) => {
    if (!id) return "was added in Notion; add leads in the CRM so they are de-duplicated and routed";
    const [l] = await c.db.select().from(leads).where(eq(leads.id, id));
    if (!l) return "was removed from the CRM";
    const set: Partial<typeof leads.$inferInsert> = {};
    if (f.name !== l.fullName) set.fullName = String(f.name).slice(0, 200);
    if (str(f.email) !== l.email) set.email = str(f.email);
    if (str(f.notes) !== l.notes) set.notes = str(f.notes);
    set.updatedAt = new Date();
    await c.db.update(leads).set(set).where(eq(leads.id, id));
    await audit(c.db, { userId: null, entity: "lead", entityId: id, action: "notion_pull", diff: { fields: Object.keys(set).filter((k) => k !== "updatedAt") } });
    return id;
  },
};

// ---------------- Team (read-only mirror; pay and equity are not copied) ----------------

const teamSpec: Spec = {
  entity: "team",
  readOnly: true,
  database: (c) => c.cfg.teamDb,
  label: (f) => `Team member "${f.name}"`,
  pending: async () => [],
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db.select().from(teamMembers).where(inArray(teamMembers.id, ids));
    return new Map(rows.map((t) => [t.id, { updatedAt: t.updatedAt, deleted: false, f: { name: t.name, role: t.role, group: t.group, status: t.status, contact: t.contact } }]));
  },
  fromPage: (_c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    return { name, role: get.select(P["Role"]), group: get.select(P["Group"]), status: get.select(P["Status"]), contact: get.email(P["Contact"]) };
  },
  toProps: () => ({}),
  apply: async (c, id, f) => {
    const values = { name: String(f.name).slice(0, 200), role: str(f.role), group: str(f.group), status: str(f.status), contact: str(f.contact), updatedAt: new Date() };
    if (id) {
      await c.db.update(teamMembers).set(values).where(eq(teamMembers.id, id));
      return id;
    }
    const [row] = await c.db.insert(teamMembers).values(values).returning({ id: teamMembers.id });
    return row.id;
  },
};

// ---------------- Sessions ----------------

const sessionSpec: Spec = {
  entity: "session",
  database: (c) => c.cfg.sessionsDb,
  label: (f) => `Session "${f.name}"`,
  pending: async (c) =>
    (
      await c.db.execute<{ id: number }>(sql`
        select x.id from programme_sessions x left join notion_links n on n.entity = 'session' and n.local_id = x.id
        where (n.id is null and x.deleted_at is null) or (n.id is not null and n.hash is distinct from ${GONE} and x.updated_at > n.synced_at)
        order by x.id limit 2000`)
    ).map((r) => Number(r.id)),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db.select().from(programmeSessions).where(inArray(programmeSessions.id, ids));
    return new Map(
      rows.map((x) => [
        x.id,
        {
          updatedAt: x.updatedAt,
          deleted: !!x.deletedAt,
          f: { name: x.name, candidate: x.enrolmentId, type: x.type, day: x.dayOfWeek, time: x.time, recorded: x.recorded, drive: x.driveLink, notes: x.notes },
        },
      ]),
    );
  },
  fromPage: (c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    const candPage = get.relation(P["Candidate"])[0];
    const candidate = c.localOf("enrolment", candPage);
    if (candPage && !candidate) return "is linked to a candidate the CRM does not know yet";
    return {
      name,
      candidate,
      type: get.select(P["Type"]),
      day: get.select(P["Day of week"]),
      time: get.text(P["Time"]),
      recorded: get.checkbox(P["Recorded?"]),
      drive: (P["Drive link"]?.url as string | null | undefined) ?? null,
      notes: get.text(P["Notes"]),
    };
  },
  toProps: (c, f) => ({
    Name: put.title(f.name as string),
    Candidate: put.relation([c.pageOf("enrolment", f.candidate as number | null)]),
    Type: put.select(f.type as string | null),
    "Day of week": put.select(f.day as string | null),
    Time: put.text(f.time as string | null),
    "Recorded?": put.checkbox(!!f.recorded),
    "Drive link": put.url(f.drive as string | null),
    Notes: put.text(f.notes as string | null),
  }),
  apply: async (c, id, f) => {
    const values = {
      name: String(f.name).slice(0, 200),
      enrolmentId: (f.candidate as number | null) ?? null,
      type: str(f.type),
      dayOfWeek: str(f.day),
      time: str(f.time),
      recorded: !!f.recorded,
      driveLink: str(f.drive),
      notes: str(f.notes),
      updatedAt: new Date(),
    };
    if (id) {
      await c.db.update(programmeSessions).set(values).where(eq(programmeSessions.id, id));
      return id;
    }
    const [row] = await c.db.insert(programmeSessions).values(values).returning({ id: programmeSessions.id });
    return row.id;
  },
  onGone: async (c, id) => {
    await c.db.update(programmeSessions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(programmeSessions.id, id));
  },
};

// ---------------- Proof & Testimonial Bank ----------------

const proofSpec: Spec = {
  entity: "proof",
  database: (c) => c.cfg.proofDb,
  label: (f) => `Proof item "${f.name}"`,
  pending: async (c) =>
    (
      await c.db.execute<{ id: number }>(sql`
        select x.id from proof_items x left join notion_links n on n.entity = 'proof' and n.local_id = x.id
        where (n.id is null and x.deleted_at is null) or (n.id is not null and n.hash is distinct from ${GONE} and x.updated_at > n.synced_at)
        order by x.id limit 2000`)
    ).map((r) => Number(r.id)),
  load: async (c, ids) => {
    if (!ids.length) return new Map();
    const rows = await c.db.select().from(proofItems).where(inArray(proofItems.id, ids));
    return new Map(
      rows.map((x) => [
        x.id,
        {
          updatedAt: x.updatedAt,
          deleted: !!x.deletedAt,
          f: {
            name: x.name,
            candidate: x.enrolmentId,
            type: x.type,
            consent: x.consentStatus,
            usable: [...x.usableIn].sort().join(","),
            file: x.fileOrLink,
            quote: x.quote,
          },
        },
      ]),
    );
  },
  fromPage: (c, p) => {
    const P = p.properties;
    const name = get.text(P["Name"]);
    if (!name) return "has no name";
    const candPage = get.relation(P["Candidate"])[0];
    const candidate = c.localOf("enrolment", candPage);
    if (candPage && !candidate) return "is linked to a candidate the CRM does not know yet";
    return {
      name,
      candidate,
      type: get.select(P["Type"]),
      consent: get.select(P["Consent status"]),
      usable: get.multi(P["Usable in"]),
      file: (P["File or link"]?.url as string | null | undefined) ?? null,
      quote: get.text(P["Real quote or transcript"]),
    };
  },
  toProps: (c, f) => ({
    Name: put.title(f.name as string),
    Candidate: put.relation([c.pageOf("enrolment", f.candidate as number | null)]),
    Type: put.select(f.type as string | null),
    "Consent status": put.select(f.consent as string | null),
    "Usable in": put.multi(f.usable as string),
    "File or link": put.url(f.file as string | null),
    "Real quote or transcript": put.text(f.quote as string | null),
  }),
  apply: async (c, id, f) => {
    const values = {
      name: String(f.name).slice(0, 200),
      enrolmentId: (f.candidate as number | null) ?? null,
      type: str(f.type),
      consentStatus: str(f.consent),
      usableIn: String(f.usable ?? "").split(",").filter(Boolean),
      fileOrLink: str(f.file),
      quote: str(f.quote),
      updatedAt: new Date(),
    };
    if (id) {
      await c.db.update(proofItems).set(values).where(eq(proofItems.id, id));
      return id;
    }
    const [row] = await c.db.insert(proofItems).values(values).returning({ id: proofItems.id });
    return row.id;
  },
  onGone: async (c, id) => {
    await c.db.update(proofItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(proofItems.id, id));
  },
};

const LEADS_DB_PROPS = {
  Name: { title: {} },
  Phone: { phone_number: {} },
  Email: { email: {} },
  Stage: { select: {} },
  Owner: { select: {} },
  Source: { select: {} },
  Segment: { select: {} },
  "Tier interest": { select: {} },
  Created: { date: {} },
  "Decision due": { date: {} },
  Notes: { rich_text: {} },
  "Open in CRM": { url: {} },
};

// ---------------- the run ----------------

async function readState(db: Db): Promise<State> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, STATE_KEY));
  return (r?.value as State) ?? {};
}
async function writeState(db: Db, s: State) {
  await db.insert(appSettings).values({ key: STATE_KEY, value: s }).onConflictDoUpdate({ target: appSettings.key, set: { value: s, updatedAt: new Date() } });
}

const isGone = (e: unknown) =>
  e instanceof NotionError && (e.status === 404 || (e.status === 400 && /archived|trash/i.test(e.message)));

async function pull(c: Ctx, spec: Spec, dbId: string, since: Date | null) {
  const pages = await c.api.query(dbId, since);
  for (const page of pages) {
    if (page.archived || page.in_trash) continue;
    const pageId = pid(page.id);
    const link = c.byPage.get(pageId);
    if (link && link.entity !== spec.entity) continue;
    const f = spec.fromPage(c, page);
    if (typeof f === "string") {
      c.error(`Notion ${spec.entity} page ${pageId.slice(0, 8)} ${f}`);
      continue;
    }
    const h = hashFields(f);
    if (link?.hash === GONE) continue;
    if (link && link.hash === h) continue; // nothing changed in the synced fields (or it is our own write)

    let localId = link?.localId ?? null;
    if (link) {
      const local = (await spec.load(c, [link.localId])).get(link.localId);
      if (!local || local.deleted) continue; // the push step archives it
      if (local.updatedAt > link.syncedAt) {
        c.r.conflicts++;
        // both sides changed since the last sync: the newer edit wins (Notion times are to the minute)
        if (local.updatedAt.getTime() >= new Date(page.last_edited_time).getTime()) continue;
      }
    } else if (spec.match) {
      const m = await spec.match(c, f);
      if (m && !c.byLocal.has(`${spec.entity}:${m}`)) localId = m;
    }

    const r = await spec.apply(c, localId, f);
    if (typeof r === "string") {
      c.error(`${spec.label(f)} ${r}`);
      continue;
    }
    if (localId === null) c.r.created++;
    else c.r.pulled++;
    const after = (await spec.load(c, [r])).get(r)!;
    await c.saveLink(spec.entity, r, pageId, { hash: h, syncedAt: after.updatedAt, notionEditedAt: page.last_edited_time });
    // some values are the CRM's to decide (a stage, a count, a normalised phone): write them back
    if (hashFields(after.f) !== h) await pushOne(c, spec, dbId, r, after);
  }
}

async function pushOne(c: Ctx, spec: Spec, dbId: string, id: number, local: Local) {
  const link = c.byLocal.get(`${spec.entity}:${id}`);
  if (link?.hash === GONE || spec.readOnly) return;
  if (local.deleted) {
    if (link) {
      try {
        await c.api.archive(link.pageId);
      } catch (e) {
        if (!isGone(e)) throw e;
      }
      c.writes++;
      await c.saveLink(spec.entity, id, link.pageId, { hash: GONE, syncedAt: local.updatedAt });
      c.r.pushed++;
    }
    return;
  }
  const h = hashFields(local.f);
  if (link && link.hash === h) {
    await c.saveLink(spec.entity, id, link.pageId, { hash: h, syncedAt: local.updatedAt, notionEditedAt: link.notionEditedAt?.toISOString() });
    return;
  }
  const props = spec.toProps(c, local.f);
  c.writes++;
  try {
    const page = link ? await c.api.update(link.pageId, props) : await c.api.create(dbId, props);
    await c.saveLink(spec.entity, id, page.id, { hash: h, syncedAt: local.updatedAt, notionEditedAt: page.last_edited_time });
    c.r.pushed++;
  } catch (e) {
    if (link && isGone(e)) {
      await c.saveLink(spec.entity, id, link.pageId, { hash: GONE, syncedAt: local.updatedAt });
      if (spec.onGone) await spec.onGone(c, id);
      else c.error(`${spec.label(local.f)} was deleted in Notion; it stays in the CRM and is no longer synced`);
      return;
    }
    throw e;
  }
}

async function push(c: Ctx, spec: Spec, dbId: string) {
  const ids = await spec.pending(c);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const locals = await spec.load(c, batch);
    for (const id of batch) {
      if (c.writes >= MAX_WRITES) {
        c.r.more = true;
        return;
      }
      const local = locals.get(id);
      if (!local) continue;
      try {
        await pushOne(c, spec, dbId, id, local);
      } catch (e) {
        c.error(`${spec.label(local.f)}: ${e instanceof NotionError ? e.message : "could not be written"}`);
        if (e instanceof NotionError && (e.status === 401 || e.status === 403 || e.status === 0)) throw e;
      }
    }
  }
}

/** One full sync. Pass an api to test against a fake Notion. */
export async function runNotionSync(db: Db, cfg: NotionConfig, api: NotionApi = new NotionHttp(cfg.token)): Promise<RunResult> {
  const c = new Ctx(db, api, { ...cfg });
  const started = new Date();
  const [run] = await db.insert(notionSyncRuns).values({ startedAt: started }).returning({ id: notionSyncRuns.id });
  const state = await readState(db);
  state.cursors ??= {};
  if ((state.version ?? 1) < SYNC_VERSION) state.cursors = {};
  try {
    for (const l of await db.select().from(notionLinks)) {
      c.byLocal.set(`${l.entity}:${l.localId}`, l);
      c.byPage.set(l.pageId, l);
    }
    if (cfg.syncLeads && !cfg.leadsDb) {
      if (!state.leadsDb) {
        const d = await api.createDatabase(cfg.parentPage, "CRM Leads", LEADS_DB_PROPS);
        state.leadsDb = d.id;
        await writeState(db, state);
      }
      c.cfg.leadsDb = state.leadsDb;
    }
    const specs = [cohortSpec, candidateSpec, teamSpec, ledgerSpec, sessionSpec, proofSpec, ...(cfg.syncLeads ? [leadSpec] : [])];
    for (const spec of specs) {
      const dbId = spec.database(c);
      if (!dbId) continue;
      const cursor = state.cursors[spec.entity];
      try {
        // two minutes of overlap: Notion edit times are rounded to the minute
        await pull(c, spec, dbId, cursor ? new Date(new Date(cursor).getTime() - 120_000) : null);
        state.cursors[spec.entity] = started.toISOString();
        await push(c, spec, dbId);
      } catch (e) {
        c.error(`${spec.entity}: ${e instanceof NotionError ? e.message : (e as Error).message}`);
        if (e instanceof NotionError && (e.status === 401 || e.status === 403)) break;
      }
    }
    // enrolments pulled above change the batch counts: send them in the same run
    if (!c.r.more) await push(c, cohortSpec, cfg.batchesDb).catch((e) => c.error(`cohort: ${(e as Error).message}`));
    if (!c.r.errors.some((e) => /^[a-z]+: /.test(e))) state.version = SYNC_VERSION;
    await writeState(db, state);
  } catch (e) {
    c.error(e instanceof NotionError ? e.message : (e as Error).message);
  }
  await db
    .update(notionSyncRuns)
    .set({ finishedAt: new Date(), pushed: c.r.pushed, pulled: c.r.pulled, created: c.r.created, conflicts: c.r.conflicts, errors: c.r.errors })
    .where(eq(notionSyncRuns.id, run.id));
  return c.r;
}

// single flight: the interval and the "Sync now" button never overlap
let running: Promise<RunResult> | null = null;
export function syncNow(db: Db, cfg = notionConfig()): Promise<RunResult> | null {
  if (!cfg) return null;
  if (!running) running = runNotionSync(db, cfg).finally(() => (running = null));
  return running;
}
export const syncRunning = () => running !== null;

export async function syncStatus(db: Db) {
  const runs = await db.select().from(notionSyncRuns).orderBy(sql`${notionSyncRuns.id} desc`).limit(10);
  const counts = await db
    .select({ entity: notionLinks.entity, n: sql<number>`count(*) filter (where ${notionLinks.hash} is distinct from ${GONE})::int` })
    .from(notionLinks)
    .groupBy(notionLinks.entity);
  const state = await readState(db);
  return { runs, linked: Object.fromEntries(counts.map((r) => [r.entity, Number(r.n)])) as Partial<Record<Entity, number>>, leadsDb: state.leadsDb ?? null };
}
