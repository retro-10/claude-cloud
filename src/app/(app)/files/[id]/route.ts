import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { INLINE_TYPES, getAttachment, getAttachmentLink } from "@/lib/attachments";
import { audit } from "@/lib/audit";
import { recordAssetDownload } from "@/lib/brand";
import { DriveError } from "@/lib/drive";
import { getCase } from "@/lib/production";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Files are private: signed in, allowed to read leads (a production case's files: allowed to see that case), and
// every download is audited. Only raster images
// open in the browser; everything else downloads, and nothing is ever run as a page (nosniff + sandbox).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "lead:read") && !can(user.role, "production:read") && !can(user.role, "brand:read")) return new NextResponse("Forbidden", { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse("Not found", { status: 404 });
  // permission first (no bytes read), then the file, which may come from Google Drive
  const link = await getAttachmentLink(db, id);
  if (!link) return new NextResponse("Not found", { status: 404 });
  // a brand asset's file: everyone with the brand hub; a case's: who may see the case; the rest: who reads leads
  const allowed = link.assetId
    ? can(user.role, "brand:read")
    : link.caseId
      ? can(user.role, "production:read") && !!(await getCase(db, link.caseId, user))
      : can(user.role, "lead:read");
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  let f;
  try {
    f = await getAttachment(db, id);
  } catch (e) {
    if (!(e instanceof DriveError)) throw e;
    return new NextResponse(`This file is kept in Google Drive, which could not be reached. ${e.message}`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (!f) return new NextResponse("Not found", { status: 404 });
  // a brand asset's thumbnail in the library (?preview=1) is not a download; everything else is logged
  const preview = !!link.assetId && req.nextUrl.searchParams.get("preview") === "1";
  if (!preview) {
    await audit(db, { userId: user.id, entity: "attachment", entityId: id, action: "download" });
    if (link.assetId) await recordAssetDownload(db, link.assetId, user.id);
  }
  // ?download=1 saves the file even when it is a picture (the brand hub's Download button)
  const inline = INLINE_TYPES.has(f.contentType) && req.nextUrl.searchParams.get("download") !== "1";
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      "Content-Type": inline ? f.contentType : "application/octet-stream",
      "Content-Length": String(f.data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'",
    },
  });
}
