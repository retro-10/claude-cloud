"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { addAttachment, deleteAttachment } from "@/lib/attachments";
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

export async function uploadFileAction(form: FormData) {
  const user = await requireCan("file:write");
  const p = z.object({ leadId: optId, cohortId: optId, note: z.string().max(500).optional() }).parse({ leadId: form.get("leadId"), cohortId: form.get("cohortId"), note: form.get("note") ?? undefined });
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return back(form, { ok: false, error: "Choose a file" }, "");
  const r = await addAttachment(db, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, p, user.id);
  back(form, r, "File added");
}

export async function deleteFileAction(form: FormData) {
  const user = await requireCan("file:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  back(form, await deleteAttachment(db, id, { id: user.id, isOwner: can(user.role, "settings:write") }), "File deleted");
}
