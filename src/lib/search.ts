import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, stages } from "@/db/schema";

// Arabic spelling variants people type interchangeably: alef forms, alef maqsura / yeh, teh marbuta / heh.
// Folded the same way in SQL (translate) and in JS so "احمد" finds "أحمد" and "فاطمه" finds "فاطمة".
const AR_FROM = "أإآٱىة";
const AR_TO = "اااايه";

export function foldArabic(s: string): string {
  let out = "";
  for (const ch of s.replace(/ـ/g, "")) {
    const i = AR_FROM.indexOf(ch);
    out += i >= 0 ? AR_TO[i] : ch;
  }
  return out.toLowerCase();
}

export const foldedSql = (col: SQL | typeof leads.fullName) => sql`translate(lower(replace(${col}, 'ـ', '')), ${AR_FROM}, ${AR_TO})`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * Digits to look for inside a stored E.164 number. Spaces, dashes and brackets are ignored, and the
 * local trunk prefix is dropped: "0100 777-66" and "+20 100 777 66" both search for "10077766".
 * Returns null when there are too few digits to be a phone search.
 */
export function phoneDigits(q: string): string | null {
  const western = q.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
  let digits = western.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("200")) digits = "20" + digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 3 ? digits : null;
}

/** The text-match condition shared by the lead list and the command palette. */
export function leadTextMatch(q: string): SQL | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const like = `%${escapeLike(foldArabic(t))}%`;
  const digits = phoneDigits(t);
  const parts = [
    sql`${foldedSql(leads.fullName)} like ${like}`,
    sql`lower(coalesce(${leads.email}, '')) like ${like}`,
    sql`${foldedSql(sql`coalesce(${leads.notes}, '')`)} like ${like}`,
    sql`${foldedSql(sql`coalesce(${leads.city}, '')`)} like ${like}`,
  ];
  if (digits) parts.push(sql`coalesce(${leads.phoneWhatsapp}, '') like ${"%" + digits + "%"}`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

export type SearchHit = { id: number; fullName: string; phone: string | null; stage: string; stageLabel: string; stageKind: string };

export async function searchLeads(db: Db, q: string, limit = 8): Promise<SearchHit[]> {
  const match = leadTextMatch(q);
  if (!match) return [];
  const prefix = escapeLike(foldArabic(q.trim())) + "%";
  return db
    .select({
      id: leads.id,
      fullName: leads.fullName,
      phone: leads.phoneWhatsapp,
      stage: leads.stage,
      stageLabel: stages.label,
      stageKind: stages.kind,
    })
    .from(leads)
    .innerJoin(stages, eq(stages.key, leads.stage))
    .where(and(isNull(leads.deletedAt), match))
    .orderBy(sql`(${foldedSql(leads.fullName)} like ${prefix}) desc`, desc(leads.updatedAt))
    .limit(limit);
}

// ---------------- ⌘K: every kind of record, permission-filtered ----------------

export type AnyHit = { kind: string; id: number; label: string; sub: string; href: string };
export type SearchScope = {
  userId: number;
  leads: boolean; // lead:read
  hq: boolean; // hq:read: tasks and docs
  growth: boolean; // growth:read: campaigns and content
  chat: boolean; // chat:write: channels
  approvalsAll: boolean; // owners see every request
  approvalsMoney: boolean; // finance sees every money request
  comms?: boolean; // comms:read: people and the announcements sent to me
  brand?: boolean; // brand:read: the asset library
};

/**
 * Matches the words typed, or nearly (a typo or a missing letter): pg_trgm's word similarity on the folded text.
 * Returns the condition and a score to sort by.
 */
function fuzzy(col: SQL, q: string) {
  const t = foldArabic(q.trim());
  const like = `%${escapeLike(t)}%`;
  const f = foldedSql(col);
  return { where: sql`(${f} like ${like} or word_similarity(${t}, ${f}) > 0.45)`, score: sql<number>`greatest(case when ${f} like ${like} then 1 else 0 end, word_similarity(${t}, ${f}))` };
}

export async function searchEverything(db: Db, scope: SearchScope, q: string, per = 4): Promise<AnyHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const { announcementReceipts, announcements, approvalRequests, brandAssets, chatChannels, cohorts, campaigns, contentItems, docs, tasks, users } = await import("@/db/schema");
  const jobs: Promise<AnyHit[]>[] = [];
  if (scope.leads) {
    jobs.push(searchLeads(db, term, per).then((h) => h.map((l) => ({ kind: "Leads", id: l.id, label: l.fullName, sub: l.stageLabel, href: `/leads/${l.id}` }))));
    const m = fuzzy(sql`${cohorts.name}`, term);
    jobs.push(
      db
        .select({ id: cohorts.id, label: cohorts.name, score: m.score })
        .from(cohorts)
        .where(m.where)
        .orderBy(desc(m.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Batches", id: x.id, label: x.label, sub: "Batch", href: `/cohorts/${x.id}` }))),
    );
  }
  if (scope.hq) {
    const t = fuzzy(sql`${tasks.title}`, term);
    jobs.push(
      db
        .select({ id: tasks.id, label: tasks.title, done: tasks.doneAt, score: t.score })
        .from(tasks)
        .where(t.where)
        .orderBy(sql`${tasks.doneAt} is not null`, desc(t.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Tasks", id: x.id, label: x.label, sub: x.done ? "Done" : "Open", href: `/tasks/${x.id}` }))),
    );
    const d = fuzzy(sql`${docs.title} || ' ' || left(${docs.body}, 2000)`, term);
    jobs.push(
      db
        .select({ id: docs.id, label: docs.title, score: d.score })
        .from(docs)
        .where(and(isNull(docs.archivedAt), d.where))
        .orderBy(desc(d.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Docs", id: x.id, label: x.label, sub: "Doc", href: `/docs/${x.id}` }))),
    );
  }
  if (scope.growth) {
    const c = fuzzy(sql`${campaigns.label}`, term);
    jobs.push(
      db
        .select({ id: campaigns.id, label: campaigns.label, score: c.score })
        .from(campaigns)
        .where(c.where)
        .orderBy(desc(c.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Campaigns", id: x.id, label: x.label, sub: "Campaign", href: `/growth/campaigns/${x.id}` }))),
    );
    const p = fuzzy(sql`${contentItems.title}`, term);
    jobs.push(
      db
        .select({ id: contentItems.id, label: contentItems.title, status: contentItems.status, score: p.score })
        .from(contentItems)
        .where(p.where)
        .orderBy(desc(p.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Content", id: x.id, label: x.label, sub: x.status, href: `/growth/content/${x.id}` }))),
    );
  }
  if (scope.chat) {
    const ch = fuzzy(sql`coalesce(${chatChannels.name}, '') || ' ' || coalesce(${chatChannels.topic}, '')`, term);
    jobs.push(
      db
        .select({ id: chatChannels.id, label: chatChannels.name, score: ch.score })
        .from(chatChannels)
        .where(and(eq(chatChannels.kind, "channel"), isNull(chatChannels.archivedAt), ch.where))
        .orderBy(desc(ch.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Chat", id: x.id, label: `#${x.label}`, sub: "Channel", href: `/chat/${x.id}` }))),
    );
  }
  if (scope.comms) {
    const u = fuzzy(sql`${users.name}`, term);
    jobs.push(
      db
        .select({ id: users.id, label: users.name, role: users.role, score: u.score })
        .from(users)
        .where(and(eq(users.active, true), u.where))
        .orderBy(desc(u.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "People", id: x.id, label: x.label, sub: x.role, href: `/people?q=${encodeURIComponent(x.label)}` }))),
    );
    const n = fuzzy(sql`${announcements.title}`, term);
    jobs.push(
      db
        .select({ id: announcements.id, label: announcements.title, score: n.score })
        .from(announcementReceipts)
        .innerJoin(announcements, eq(announcements.id, announcementReceipts.announcementId))
        .where(and(eq(announcementReceipts.userId, scope.userId), isNull(announcements.archivedAt), n.where))
        .orderBy(desc(n.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Announcements", id: x.id, label: x.label, sub: "Announcement", href: `/announcements/${x.id}` }))),
    );
  }
  if (scope.brand) {
    const b = fuzzy(sql`${brandAssets.name} || ' ' || array_to_string(${brandAssets.tags}, ' ')`, term);
    jobs.push(
      db
        .select({ id: brandAssets.id, label: brandAssets.name, type: brandAssets.type, score: b.score })
        .from(brandAssets)
        .where(and(eq(brandAssets.status, "active"), b.where))
        .orderBy(desc(b.score))
        .limit(per)
        .then((r) => r.map((x) => ({ kind: "Brand assets", id: x.id, label: x.label, sub: x.type.replace("_", " "), href: `/brand/assets/${x.id}` }))),
    );
  }
  // approval requests this person may see: their own, the ones they approve, all (owners), money ones (finance)
  const a = fuzzy(sql`${approvalRequests.title}`, term);
  const visible = scope.approvalsAll
    ? sql`true`
    : sql`(${approvalRequests.requesterId} = ${scope.userId} or ${scope.userId} = any(${approvalRequests.approverIds})${scope.approvalsMoney ? sql` or ${approvalRequests.type} in ('expense', 'purchase')` : sql``})`;
  jobs.push(
    db
      .select({ id: approvalRequests.id, label: approvalRequests.title, status: approvalRequests.status, score: a.score })
      .from(approvalRequests)
      .where(and(visible, a.where))
      .orderBy(desc(a.score))
      .limit(per)
      .then((r) => r.map((x) => ({ kind: "Approvals", id: x.id, label: x.label, sub: x.status.replace("_", " "), href: `/approvals/${x.id}` }))),
  );
  return (await Promise.all(jobs)).flat();
}
