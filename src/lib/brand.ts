import { and, arrayOverlaps, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { attachments, brandAssetDownloads, brandAssets, docs, users } from "@/db/schema";
import { addAttachment } from "./attachments";
import { audit } from "./audit";
import type { Fail } from "./result";

// The brand hub: guideline pages (docs marked "brand") next to the asset library, so people take approved files
// from one place instead of asking for them. A new version retires the old one everywhere; downloads are counted.

export const ASSET_TYPES = [
  { key: "logo", label: "Logo" },
  { key: "photo", label: "Photo" },
  { key: "video", label: "Video" },
  { key: "template", label: "Template" },
  { key: "font", label: "Font" },
  { key: "brand_doc", label: "Brand document" },
  { key: "other", label: "Other" },
] as const;
export const assetTypeLabel = (k: string) => ASSET_TYPES.find((t) => t.key === k)?.label ?? k;

const SAFE_URL = /^https:\/\/[^\s]+$/i;
const tagList = (raw: string | string[] | undefined) =>
  [...new Set((Array.isArray(raw) ? raw : (raw ?? "").split(","))
    .map((t) => t.trim().toLowerCase().slice(0, 30))
    .filter(Boolean))].slice(0, 12);

export type AssetInput = { name: string; type: string; tags?: string | string[]; usageNotes?: string | null; version?: string | null; url?: string | null };
type FileIn = { name: string; bytes: Buffer } | null;

function check(input: AssetInput): { ok: true; values: Omit<typeof brandAssets.$inferInsert, "createdBy"> } | Fail {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the asset" };
  if (!ASSET_TYPES.some((t) => t.key === input.type)) return { ok: false, error: "Pick the kind of asset" };
  const url = input.url?.trim() || null;
  if (url && !SAFE_URL.test(url)) return { ok: false, error: "A link must start with https://" };
  return {
    ok: true,
    values: { name, type: input.type, tags: tagList(input.tags), usageNotes: input.usageNotes?.trim().slice(0, 2000) || null, version: input.version?.trim().slice(0, 40) || null, url },
  };
}

/** A new asset: a file (up to 8 MB, the usual file rules) or a link. */
export async function createAsset(db: Db, userId: number, input: AssetInput, file: FileIn): Promise<{ ok: true; id: number } | Fail> {
  const c = check(input);
  if (!c.ok) return c;
  if (!file && !c.values.url) return { ok: false, error: "Add the file, or a link to it" };
  const [row] = await db.insert(brandAssets).values({ ...c.values, createdBy: userId }).returning({ id: brandAssets.id });
  if (file) {
    const up = await addAttachment(db, file, { assetId: row.id }, userId);
    if (!up.ok) {
      await db.delete(brandAssets).where(eq(brandAssets.id, row.id));
      return up;
    }
  }
  await audit(db, { userId, entity: "brand_asset", entityId: row.id, action: "create", diff: { name: c.values.name, type: c.values.type } });
  return { ok: true, id: row.id };
}

/** A new version: a new asset with the same details unless changed; the one it replaces is retired. */
export async function newVersion(db: Db, userId: number, id: number, input: { version?: string | null; usageNotes?: string | null; url?: string | null }, file: FileIn): Promise<{ ok: true; id: number } | Fail> {
  const [old] = await db.select().from(brandAssets).where(eq(brandAssets.id, id));
  if (!old) return { ok: false, error: "That asset does not exist" };
  if (old.status !== "active") return { ok: false, error: "Only the current version can be replaced" };
  const r = await createAsset(
    db,
    userId,
    { name: old.name, type: old.type, tags: old.tags, usageNotes: input.usageNotes ?? old.usageNotes, version: input.version, url: input.url ?? (file ? null : old.url) },
    file,
  );
  if (!r.ok) return r;
  await db.update(brandAssets).set({ replacesId: old.id }).where(eq(brandAssets.id, r.id));
  await db.update(brandAssets).set({ status: "retired", retiredAt: new Date(), retiredBy: userId }).where(eq(brandAssets.id, old.id));
  await audit(db, { userId, entity: "brand_asset", entityId: old.id, action: "replaced", diff: { by: r.id } });
  return r;
}

export async function setRetired(db: Db, userId: number, id: number, retired: boolean): Promise<{ ok: true } | Fail> {
  const done = await db
    .update(brandAssets)
    .set(retired ? { status: "retired", retiredAt: new Date(), retiredBy: userId } : { status: "active", retiredAt: null, retiredBy: null })
    .where(eq(brandAssets.id, id))
    .returning({ id: brandAssets.id });
  if (!done.length) return { ok: false, error: "That asset does not exist" };
  await audit(db, { userId, entity: "brand_asset", entityId: id, action: retired ? "retire" : "restore" });
  return { ok: true };
}

export async function updateAsset(db: Db, userId: number, id: number, input: AssetInput): Promise<{ ok: true } | Fail> {
  const c = check(input);
  if (!c.ok) return c;
  const done = await db.update(brandAssets).set(c.values).where(eq(brandAssets.id, id)).returning({ id: brandAssets.id });
  if (!done.length) return { ok: false, error: "That asset does not exist" };
  await audit(db, { userId, entity: "brand_asset", entityId: id, action: "update" });
  return { ok: true };
}

export async function recordAssetDownload(db: Db, assetId: number, userId: number) {
  await db.insert(brandAssetDownloads).values({ assetId, userId });
}

const fileOf = sql<number | null>`(select a.id from ${attachments} a where a.asset_id = ${brandAssets.id} and a.deleted_at is null order by a.id desc limit 1)`;
const fileType = sql<string | null>`(select a.content_type from ${attachments} a where a.asset_id = ${brandAssets.id} and a.deleted_at is null order by a.id desc limit 1)`;
const downloads = sql<number>`(select count(*) from ${brandAssetDownloads} d where d.asset_id = ${brandAssets.id})::int`;

export type AssetRow = typeof brandAssets.$inferSelect & { fileId: number | null; contentType: string | null; downloads: number };

/** The library: current assets by default, filtered by kind, tag or text. */
export async function listAssets(db: Db, f: { q?: string; type?: string; tag?: string; retired?: boolean } = {}): Promise<AssetRow[]> {
  const like = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  const rows = await db
    .select({ a: brandAssets, fileId: fileOf, contentType: fileType, downloads })
    .from(brandAssets)
    .where(
      and(
        eq(brandAssets.status, f.retired ? "retired" : "active"),
        f.type ? eq(brandAssets.type, f.type) : undefined,
        f.tag ? arrayOverlaps(brandAssets.tags, [f.tag]) : undefined,
        like ? or(ilike(brandAssets.name, like), ilike(sql`coalesce(${brandAssets.usageNotes}, '')`, like)) : undefined,
      ),
    )
    .orderBy(asc(brandAssets.type), asc(brandAssets.name));
  return rows.map((r) => ({ ...r.a, fileId: r.fileId, contentType: r.contentType, downloads: r.downloads }));
}

export async function allTags(db: Db): Promise<string[]> {
  const rows = await db.select({ t: sql<string>`distinct unnest(${brandAssets.tags})` }).from(brandAssets).where(eq(brandAssets.status, "active"));
  return rows.map((r) => r.t).sort();
}

/** One asset with its version history (older and newer) and, for managers, who downloaded it. */
export async function getAsset(db: Db, id: number) {
  const [row] = await db.select({ a: brandAssets, fileId: fileOf, contentType: fileType, downloads, creator: users.name }).from(brandAssets).leftJoin(users, eq(users.id, brandAssets.createdBy)).where(eq(brandAssets.id, id));
  if (!row) return null;
  // walk the chain both ways: what this replaced, and what replaced it
  const chain: (typeof brandAssets.$inferSelect)[] = [row.a];
  let back = row.a.replacesId;
  while (back && chain.length < 50) {
    const [p] = await db.select().from(brandAssets).where(eq(brandAssets.id, back));
    if (!p) break;
    chain.push(p);
    back = p.replacesId;
  }
  let fwd = row.a.id;
  const newer: (typeof brandAssets.$inferSelect)[] = [];
  while (newer.length < 50) {
    const [n] = await db.select().from(brandAssets).where(eq(brandAssets.replacesId, fwd));
    if (!n) break;
    newer.unshift(n);
    fwd = n.id;
  }
  const recent = await db
    .select({ name: users.name, at: brandAssetDownloads.createdAt })
    .from(brandAssetDownloads)
    .leftJoin(users, eq(users.id, brandAssetDownloads.userId))
    .where(eq(brandAssetDownloads.assetId, id))
    .orderBy(desc(brandAssetDownloads.createdAt))
    .limit(20);
  return { ...row.a, fileId: row.fileId, contentType: row.contentType, downloads: row.downloads, creator: row.creator, versions: [...newer, ...chain], current: newer[0] ?? null, recentDownloads: recent };
}

/** Guideline pages: docs marked as part of the brand, newest first. */
export const brandPages = (db: Db) =>
  db.select({ id: docs.id, title: docs.title, updatedAt: docs.updatedAt }).from(docs).where(and(eq(docs.brand, true), isNull(docs.archivedAt))).orderBy(asc(docs.title));

