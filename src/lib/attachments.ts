import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { attachments, cohorts, leads, users } from "@/db/schema";
import { audit } from "./audit";

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

type Link = { leadId?: number | null; cohortId?: number | null };
type Fail = { ok: false; error: string };

export async function addAttachment(db: Db, file: { name: string; bytes: Buffer }, link: Link & { note?: string | null }, userId: number | null): Promise<{ ok: true; id: number } | Fail> {
  if (!!link.leadId === !!link.cohortId) return { ok: false, error: "Attach the file to a lead or a batch" };
  const name = cleanName(file.name);
  const type = ALLOWED_EXT[ext(name)];
  if (!type) return { ok: false, error: `That kind of file is not accepted. Allowed: ${Object.keys(ALLOWED_EXT).join(", ")}` };
  if (!file.bytes.length) return { ok: false, error: "The file is empty" };
  if (file.bytes.length > MAX_FILE_BYTES) return { ok: false, error: "Files can be up to 8 MB. Share larger ones (videos) by link in a note." };
  if (link.leadId) {
    const [l] = await db.select({ deletedAt: leads.deletedAt }).from(leads).where(eq(leads.id, link.leadId));
    if (!l || l.deletedAt) return { ok: false, error: "That lead no longer exists" };
  } else {
    const [c] = await db.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, link.cohortId!));
    if (!c) return { ok: false, error: "That batch no longer exists" };
  }
  const [row] = await db
    .insert(attachments)
    .values({
      fileName: name,
      contentType: type,
      size: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      data: file.bytes,
      note: link.note?.trim().slice(0, 500) || null,
      leadId: link.leadId ?? null,
      cohortId: link.cohortId ?? null,
      uploadedBy: userId,
    })
    .returning({ id: attachments.id });
  await audit(db, { userId, entity: "attachment", entityId: row.id, action: "upload", diff: { leadId: link.leadId ?? null, cohortId: link.cohortId ?? null, size: file.bytes.length } });
  return { ok: true, id: row.id };
}

export type AttachmentRow = { id: number; fileName: string; contentType: string; size: number; note: string | null; createdAt: Date; uploadedBy: number | null; uploader: string | null };

export async function listAttachments(db: Db, link: Link): Promise<AttachmentRow[]> {
  const where = link.leadId ? eq(attachments.leadId, link.leadId) : link.cohortId ? eq(attachments.cohortId, link.cohortId) : sql`false`;
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

/** The file with its bytes, for the download route. Deleted files are gone. */
export async function getAttachment(db: Db, id: number) {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
  return row ?? null;
}

/** The uploader or an owner. The bytes are removed; the record stays for the audit trail. */
export async function deleteAttachment(db: Db, id: number, user: { id: number; isOwner: boolean }): Promise<{ ok: true } | Fail> {
  const [row] = await db.select({ uploadedBy: attachments.uploadedBy, deletedAt: attachments.deletedAt }).from(attachments).where(eq(attachments.id, id));
  if (!row || row.deletedAt) return { ok: false, error: "That file is already gone" };
  if (!user.isOwner && row.uploadedBy !== user.id) return { ok: false, error: "Only the person who added it, or an owner, can delete a file" };
  await db.update(attachments).set({ deletedAt: new Date(), data: Buffer.alloc(0), size: 0 }).where(eq(attachments.id, id));
  await audit(db, { userId: user.id, entity: "attachment", entityId: id, action: "delete" });
  return { ok: true };
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
