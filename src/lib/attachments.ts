import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { attachments, brandAssets, cohorts, leads, productionCases, users } from "@/db/schema";
import { audit } from "./audit";
import { DriveError, downloadFromDrive, driveOn, driveStatus, trashInDrive, uploadToDrive } from "./drive";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;

// What people attach at Camp: documents, images, spreadsheets, archives, and dental case files.
// Anything else (programs, scripts, web pages) is refused.
export const ALLOWED_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  stl: "model/stl",
  ply: "application/octet-stream",
  obj: "model/obj",
  dcm: "application/dicom",
};
/** Shown in the browser (a preview) rather than downloaded: raster images only, never SVG, HTML or PDF. */
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";
/** A file name safe to show and to put in a download header: no paths, no control characters, 120 chars. */
export const cleanName = (name: string) =>
  name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(-120) || "file";

type Link = { leadId?: number | null; cohortId?: number | null; caseId?: number | null; assetId?: number | null };
/** What a file in Drive belongs to, in its description, so the folder makes sense on its own. */
const describe = (l: Link) =>
  l.leadId ? `OrlaDent lead ${l.leadId}` : l.cohortId ? `OrlaDent batch ${l.cohortId}` : l.assetId ? `OrlaDent brand asset ${l.assetId}` : `OrlaDent production case ${l.caseId}`;
type Fail = { ok: false; error: string };

export async function addAttachment(db: Db, file: { name: string; bytes: Buffer }, link: Link & { note?: string | null }, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  if ([link.leadId, link.cohortId, link.caseId, link.assetId].filter(Boolean).length !== 1) return { ok: false, error: "Attach the file to a lead, a batch or a case" };
  const name = cleanName(file.name);
  const type = ALLOWED_EXT[ext(name)];
  if (!type) return { ok: false, error: `That kind of file is not accepted. Allowed: ${Object.keys(ALLOWED_EXT).join(", ")}` };
  if (!file.bytes.length) return { ok: false, error: "The file is empty" };
  if (file.bytes.length > MAX_FILE_BYTES) return { ok: false, error: "Files can be up to 8 MB. Share larger ones (videos) by link in a note." };
  if (link.leadId) {
    const [l] = await db.select({ deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, link.leadId));
    if (!l || l.deletedAt) return { ok: false, error: "That lead no longer exists" };
  } else if (link.cohortId) {
    const [c] = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, link.cohortId));
    if (!c) return { ok: false, error: "That batch no longer exists" };
  } else if (link.assetId) {
    const [a] = await db.select({ id: brandAssets.id }).from(brandAssets).where(eq(brandAssets.id, link.assetId));
    if (!a) return { ok: false, error: "That asset no longer exists" };
  } else {
    const [c] = await db.select({ id: productionCases.id }).from(productionCases).where(eq(productionCases.id, link.caseId!));
    if (!c) return { ok: false, error: "That case no longer exists" };
  }
  // With Google Drive connected the bytes go there. If Drive cannot be reached the file is kept in the database
  // instead, so the upload still works, and moveFilesToDrive takes it across later.
  let driveFileId: string | null = null;
  let driveError: string | undefined;
  if (driveOn(await driveStatus(db))) {
    try {
      driveFileId = await uploadToDrive(db, { name, contentType: type, bytes: file.bytes, description: describe(link) });
    } catch (e) {
      driveError = e instanceof DriveError ? e.message : "Google Drive could not be reached";
    }
  }
  const [row] = await db
    .insert(attachments)
    .values({
      fileName: name,
      contentType: type,
      size: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      data: driveFileId ? null : file.bytes,
      driveFileId,
      note: link.note?.trim().slice(0, 500) || null,
      leadId: link.leadId ?? null,
      cohortId: link.cohortId ?? null,
      caseId: link.caseId ?? null,
      assetId: link.assetId ?? null,
      uploadedBy: userId,
    })
    .returning({ id: attachments.id });
  await audit(db, { userId, entity: "attachment", entityId: row.id, action: "upload", diff: { leadId: link.leadId ?? null, cohortId: link.cohortId ?? null, caseId: link.caseId ?? null, assetId: link.assetId ?? null, size: file.bytes.length, store: driveFileId ? "drive" : "database", driveError } });
  return { ok: true, id: row.id };
}

export type AttachmentRow = { id: number; fileName: string; contentType: string; size: number; note: string | null; createdAt: Date; uploadedBy: number | null; uploader: string | null };

export async function listAttachments(db: Db, link: Link): Promise<AttachmentRow[]> {
  const where = link.leadId
    ? eq(attachments.leadId, link.leadId)
    : link.cohortId
      ? eq(attachments.cohortId, link.cohortId)
      : link.caseId
        ? eq(attachments.caseId, link.caseId)
        : link.assetId
          ? eq(attachments.assetId, link.assetId)
          : sql`false`;
  return db
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      contentType: attachments.contentType,
      size: attachments.size,
      note: attachments.note,
      createdAt: attachments.createdAt,
      uploadedBy: attachments.uploadedBy,
      uploader: users.name,
    })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(where, isNull(attachments.deletedAt)))
    .orderBy(desc(attachments.createdAt));
}

/** The file with its bytes (from Drive when it lives there), for the download route. Deleted files are gone.
 * Throws DriveError when Drive cannot be reached. */
export async function getAttachment(db: Db, id: number) {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  if (!row) return null;
  const data = row.data ?? (row.driveFileId ? await downloadFromDrive(db, row.driveFileId) : Buffer.alloc(0));
  return { ...row, data };
}

/** What a file is attached to (no bytes): the download route and delete check permissions with it. */
export async function getAttachmentLink(db: Db, id: number) {
  const [row] = await db.select({ leadId: attachments.leadId, cohortId: attachments.cohortId, caseId: attachments.caseId, assetId: attachments.assetId }).from(attachments).where(eq(attachments.id, id));
  return row ?? null;
}

/** The uploader or an owner. The bytes are removed; the record stays for the audit trail. */
export async function deleteAttachment(db: Db, id: number, user: { id: number; isOwner: boolean }): Promise<{ ok: true } | Fail> {
  const [row] = await db
    .select({ uploadedBy: attachments.uploadedBy, deletedAt: attachments.deletedAt, driveFileId: attachments.driveFileId })
    .from(attachments)
    .where(eq(attachments.id, id));
  if (!row || row.deletedAt) return { ok: false, error: "That file is already gone" };
  if (!user.isOwner && row.uploadedBy !== user.id) return { ok: false, error: "Only the person who added it, or an owner, can delete a file" };
  // a file in Drive goes to Drive's bin; if Drive is unreachable it is still removed here, and the audit says so
  let driveTrashed: boolean | undefined;
  if (row.driveFileId) driveTrashed = await trashInDrive(db, row.driveFileId).then(() => true, () => false);
  await db.update(attachments).set({ deletedAt: new Date(), data: null, size: 0 }).where(eq(attachments.id, id));
  await audit(db, { userId: user.id, entity: "attachment", entityId: id, action: "delete", diff: row.driveFileId ? { driveFileId: row.driveFileId, driveTrashed } : undefined });
  return { ok: true };
}

let moving = false;

/** Takes files still kept in the database across to Google Drive, a few at a time (the 5-minute tick and the button
 * in Settings > Integrations call it). Each file is uploaded before its bytes are cleared, so nothing is lost if a
 * step fails; it is simply tried again next time. */
export async function moveFilesToDrive(db: Db, limit = 10): Promise<{ moved: number; failed: number; error?: string }> {
  if (moving || !driveOn(await driveStatus(db))) return { moved: 0, failed: 0 };
  moving = true;
  let moved = 0;
  let failed = 0;
  let error: string | undefined;
  try {
    const ids = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(isNull(attachments.driveFileId), isNull(attachments.deletedAt), isNotNull(attachments.data)))
      .orderBy(asc(attachments.id))
      .limit(limit);
    for (const { id } of ids) {
      const [f] = await db.select().from(attachments).where(eq(attachments.id, id));
      if (!f?.data) continue;
      try {
        const driveFileId = await uploadToDrive(db, { name: f.fileName, contentType: f.contentType, bytes: f.data, description: describe(f) });
        await db.update(attachments).set({ driveFileId, data: null }).where(and(eq(attachments.id, id), isNull(attachments.driveFileId)));
        moved++;
      } catch (e) {
        failed++;
        error = e instanceof DriveError ? e.message : "Google Drive could not be reached";
        if (e instanceof DriveError) break; // the same problem would stop every other file too
      }
    }
  } finally {
    moving = false;
  }
  return { moved, failed, error };
}

/** Where files are kept, for Settings > Integrations. */
export async function fileStoreCounts(db: Db) {
  const [r] = await db
    .select({
      inDrive: sql<number>`count(*) filter (where ${attachments.driveFileId} is not null)::int`,
      inDatabase: sql<number>`count(*) filter (where ${attachments.driveFileId} is null)::int`,
      databaseBytes: sql<number>`coalesce(sum(${attachments.size}) filter (where ${attachments.driveFileId} is null), 0)::bigint`,
    })
    .from(attachments)
    .where(isNull(attachments.deletedAt));
  return { inDrive: r.inDrive, inDatabase: r.inDatabase, databaseBytes: Number(r.databaseBytes) };
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
