"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { addAttachment, deleteAttachment, getAttachmentLink } from "@/lib/attachments";
import { canWorkOnCase } from "@/lib/production";
import { can } from "@/lib/rbac";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";

const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());

function back(form: FormData, r: { ok: true } | { ok: false; error: string }, notice: string) {
  const to = safePath(form.get("back"), "/");
  revalidatePath(to.split("?")[0]);
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

// Files on a production case are the design work: the case's designer (while working on it) and managers add them,
// with production:work rather than file:write, which designers do not have.
export async function uploadFileAction(form: FormData) {
  const p = z
    .object({ leadId: optId, cohortId: optId, caseId: optId, note: z.string().max(500).optional() })
    .parse({ leadId: form.get("leadId"), cohortId: form.get("cohortId"), caseId: form.get("caseId"), note: form.get("note") ?? undefined });
  const user = await requireCan(p.caseId ? "production:work" : "file:write");
  if (p.caseId && !(await canWorkOnCase(db, p.caseId, user))) return back(form, { ok: false, error: "Files can be added only to a case you are working on" }, "");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return back(form, { ok: false, error: "Choose a file" }, "");
  const r = await addAttachment(db, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, p, user.id);
  back(form, r, "File added");
}

export async function deleteFileAction(form: FormData) {
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  const link = await getAttachmentLink(db, id);
  const user = await requireCan(link?.caseId ? "production:work" : "file:write");
  if (link?.caseId && !(await canWorkOnCase(db, link.caseId, user))) return back(form, { ok: false, error: "Files can be removed only from a case you are working on" }, "");
  back(form, await deleteAttachment(db, id, { id: user.id, isOwner: can(user.role, "settings:write") }), "File deleted");
}
