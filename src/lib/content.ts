import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, contentItems, enrolments, proofItems, users } from "@/db/schema";
import { audit } from "./audit";
import { slugify } from "./campaigns";
import { publishable } from "./programme";

export const PLATFORMS = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn", whatsapp: "WhatsApp", other: "Other" } as const;
export const FORMATS = { reel: "Reel", post: "Post", carousel: "Carousel", story: "Story", live: "Live", video: "Video", broadcast: "Broadcast", other: "Other" } as const;
export const STATUSES = { idea: "Idea", scripting: "Scripting", filming: "Filming", editing: "Editing", scheduled: "Scheduled", posted: "Posted" } as const;
export type Platform = keyof typeof PLATFORMS;
export type Format = keyof typeof FORMATS;
export type ContentStatus = keyof typeof STATUSES;

export type ContentInput = {
  title: string;
  platform: Platform;
  format: Format;
  status: ContentStatus;
  ownerId?: number | null;
  publishAt?: Date | null;
  campaignId?: number | null;
  brief?: string | null;
  caption?: string | null;
  postUrl?: string | null;
};
type Fail = { ok: false; error: string };
const clean = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

export async function saveContent(db: Db, id: number | null, c: ContentInput, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  const title = clean(c.title, 200);
  if (!title) return { ok: false, error: "Give the piece a working title" };
  if (!(c.platform in PLATFORMS) || !(c.format in FORMATS) || !(c.status in STATUSES)) return { ok: false, error: "Choose platform, format and status" };
  const postUrl = clean(c.postUrl, 500);
  if (postUrl && !/^https?:\/\/\S+$/i.test(postUrl)) return { ok: false, error: "The post link must start with https://" };
  const values = {
    title,
    platform: c.platform,
    format: c.format,
    status: c.status,
    ownerId: c.ownerId ?? null,
    publishAt: c.publishAt ?? null,
    campaignId: c.campaignId ?? null,
    brief: clean(c.brief, 4000),
    caption: clean(c.caption, 4000),
    postUrl,
    updatedAt: new Date(),
  };
  if (id) {
    const [cur] = await db.select({ postedAt: contentItems.postedAt }).from(contentItems).where(and(eq(contentItems.id, id), isNull(contentItems.deletedAt)));
    if (!cur) return { ok: false, error: "Not found" };
    await db
      .update(contentItems)
      .set({ ...values, postedAt: c.status === "posted" ? (cur.postedAt ?? new Date()) : null })
      .where(eq(contentItems.id, id));
    await audit(db, { userId, entity: "content", entityId: id, action: "update" });
    return { ok: true, id };
  }
  const [row] = await db.insert(contentItems).values({ ...values, postedAt: c.status === "posted" ? new Date() : null, createdBy: userId }).returning({ id: contentItems.id });
  // the tag for its links: short, unique, readable in reports
  await db.update(contentItems).set({ tag: `c${row.id}-${slugify(title)}`.slice(0, 40).replace(/-+$/, "") }).where(eq(contentItems.id, row.id));
  await audit(db, { userId, entity: "content", entityId: row.id, action: "create" });
  return { ok: true, id: row.id };
}

export async function setContentStatus(db: Db, id: number, status: ContentStatus, userId: number | null) {
  if (!(status in STATUSES)) return false;
  const rows = await db
    .update(contentItems)
    .set({ status, updatedAt: new Date(), postedAt: status === "posted" ? sql`coalesce(${contentItems.postedAt}, now())` : null })
    .where(and(eq(contentItems.id, id), isNull(contentItems.deletedAt)))
    .returning({ id: contentItems.id });
  if (rows.length) await audit(db, { userId, entity: "content", entityId: id, action: "status", diff: { status } });
  return rows.length > 0;
}

export async function deleteContent(db: Db, id: number, userId: number | null) {
  await db.update(contentItems).set({ deletedAt: new Date() }).where(eq(contentItems.id, id));
  await audit(db, { userId, entity: "content", entityId: id, action: "delete" });
}

const FORMAT_FROM_USE: Record<string, Format> = { Reel: "reel", Carousel: "carousel", Story: "story", YouTube: "video", Text: "post" };

/** Proof-to-post: a content idea made from a proof item, only when its consent allows publishing. */
export async function contentFromProof(db: Db, proofId: number, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  const [row] = await db
    .select({ p: proofItems, consent: enrolments.contentConsent, scope: enrolments.contentConsentScope })
    .from(proofItems)
    .leftJoin(enrolments, eq(enrolments.id, proofItems.enrolmentId))
    .where(and(eq(proofItems.id, proofId), isNull(proofItems.deletedAt)));
  if (!row) return { ok: false, error: "Proof item not found" };
  if (!publishable(row.p, row.consent)) return { ok: false, error: "Not ready to use: consent is not granted" };
  const [existing] = await db.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.proofItemId, proofId), isNull(contentItems.deletedAt)));
  if (existing) return { ok: true, id: existing.id };
  const scope = row.scope?.length ? `Consent covers: ${row.scope.join(", ")}.` : "Check what the consent covers before using names or faces.";
  const brief = [row.p.quote ? `Quote (word for word): "${row.p.quote}"` : null, row.p.type ? `Proof type: ${row.p.type}.` : null, scope, row.p.fileOrLink ? `File: ${row.p.fileOrLink}` : null, "No income promises."]
    .filter(Boolean)
    .join("\n");
  const r = await saveContent(db, null, { title: `Proof: ${row.p.name}`, platform: "instagram", format: FORMAT_FROM_USE[row.p.usableIn[0]] ?? "reel", status: "idea", brief, ownerId: userId }, userId);
  if (!r.ok) return r;
  await db.update(contentItems).set({ proofItemId: proofId }).where(eq(contentItems.id, r.id));
  return r;
}

export type ContentRow = Awaited<ReturnType<typeof listContent>>[number];

/** Pieces in a date range (by publish date), plus every undated idea; with the leads its tag brought in. */
export async function listContent(db: Db, f: { from: Date; to: Date; status?: ContentStatus; includeUndated?: boolean }) {
  const where: (SQL | undefined)[] = [isNull(contentItems.deletedAt)];
  const inRange = sql`${contentItems.publishAt} >= ${f.from.toISOString()}::timestamptz and ${contentItems.publishAt} < ${f.to.toISOString()}::timestamptz`;
  where.push(f.includeUndated === false ? inRange : sql`(${inRange} or ${contentItems.publishAt} is null)`);
  if (f.status) where.push(eq(contentItems.status, f.status));
  const rows = await db
    .select({
      c: contentItems,
      owner: users.name,
      campaign: campaigns.label,
      leads: sql<number>`(select count(*) from leads l where l.deleted_at is null and l.attribution->>'utm_content' = ${contentItems.tag})::int`,
    })
    .from(contentItems)
    .leftJoin(users, eq(users.id, contentItems.ownerId))
    .leftJoin(campaigns, eq(campaigns.id, contentItems.campaignId))
    .where(and(...where))
    .orderBy(sql`${contentItems.publishAt} asc nulls last`, asc(contentItems.id));
  return rows.map((r) => ({ ...r.c, owner: r.owner, campaign: r.campaign, leads: Number(r.leads) }));
}

export async function getContent(db: Db, id: number) {
  const [r] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), isNull(contentItems.deletedAt)));
  return r ?? null;
}
