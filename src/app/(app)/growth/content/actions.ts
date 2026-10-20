"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { FORMATS, PLATFORMS, STATUSES, contentFromProof, deleteContent, saveContent, setContentStatus, type ContentStatus, type Format, type Platform } from "@/lib/content";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string];

function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

export async function saveContentAction(form: FormData) {
  const user = await requireCan("growth:write");
  const p = z
    .object({
      id: optId,
      title: z.string().max(400),
      platform: z.enum(keys(PLATFORMS)),
      format: z.enum(keys(FORMATS)),
      status: z.enum(keys(STATUSES)),
      ownerId: optId,
      publishAt: z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable()),
      campaignId: optId,
      brief: z.string().max(8000).optional(),
      caption: z.string().max(8000).optional(),
      postUrl: z.string().max(600).optional(),
    })
    .parse(Object.fromEntries(form));
  const publishAt = p.publishAt ? cairoLocalToDate(p.publishAt.length === 10 ? `${p.publishAt}T12:00` : p.publishAt) : null;
  const r = await saveContent(db, p.id, { ...p, platform: p.platform as Platform, format: p.format as Format, status: p.status as ContentStatus, publishAt }, user.id);
  revalidatePath("/growth/content");
  if (r.ok) done(`/growth/content/${r.id}`, r, p.id ? "Saved" : "Added to the calendar");
  done(safePath(form.get("back"), "/growth/content"), r, "");
}

export async function contentStatusAction(form: FormData) {
  const user = await requireCan("growth:write");
  const p = z.object({ id: z.coerce.number().int().positive(), status: z.enum(keys(STATUSES)) }).parse({ id: form.get("id"), status: form.get("status") });
  const ok = await setContentStatus(db, p.id, p.status as ContentStatus, user.id);
  revalidatePath("/growth/content");
  done(safePath(form.get("back"), "/growth/content?view=board"), ok ? { ok: true } : { ok: false, error: "Not found" }, `Moved to ${STATUSES[p.status as ContentStatus]}`);
}

export async function deleteContentAction(form: FormData) {
  const user = await requireCan("growth:write");
  const id = z.coerce.number().int().positive().parse(form.get("id"));
  await deleteContent(db, id, user.id);
  revalidatePath("/growth/content");
  done("/growth/content", { ok: true }, "Removed from the calendar");
}

// From the proof bank: an idea on the calendar, pre-filled with the quote and what the consent covers.
export async function contentFromProofAction(form: FormData) {
  const user = await requireCan("growth:write");
  const id = z.coerce.number().int().positive().parse(form.get("proofId"));
  const r = await contentFromProof(db, id, user.id);
  if (r.ok) done(`/growth/content/${r.id}`, r, "Content idea made from the proof item");
  done("/proof", r, "");
}
