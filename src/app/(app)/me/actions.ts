"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { acknowledgeDocument, requestChange, updateContact } from "@/lib/employees";
import type { Result } from "@/lib/result";
import { requireCan, requireTwoFactor } from "@/lib/server-auth";

const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

function go(to: string, r: Result, notice: string): never {
  revalidatePath("/me");
  const [path, hash] = to.split("#");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${r.ok ? `notice=${encodeURIComponent(notice)}` : `error=${encodeURIComponent(r.error)}`}${hash ? `#${hash}` : ""}`);
}

/** My own contact details. */
export async function updateContactAction(form: FormData) {
  const user = await requireCan("employee:self");
  requireTwoFactor(user);
  const p = z.object({ phone: text(200), personalEmail: text(200), address: text(400), emergencyName: text(200), emergencyPhone: text(200) }).parse(Object.fromEntries(form));
  go("/me#profile", await updateContact(db, user.id, p), "Contact details saved");
}

/** Ask an owner to change something I cannot edit myself. */
export async function requestChangeAction(form: FormData) {
  const user = await requireCan("employee:self");
  requireTwoFactor(user);
  const p = z.object({ field: text(40), value: text(400), reason: text(1000) }).parse(Object.fromEntries(form));
  go("/me#requests", await requestChange(db, user, p.field, p.value, p.reason), "Sent to the owners");
}

export async function acknowledgeDocumentAction(form: FormData) {
  const user = await requireCan("employee:self");
  requireTwoFactor(user);
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  go(`/me/documents/${id}`, await acknowledgeDocument(db, user.id, id), "Recorded: you have read and accepted it");
}
