"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { createAsset, newVersion, setRetired, updateAsset } from "@/lib/brand";
import type { Result } from "@/lib/result";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

function go(to: string, r: Result, notice: string): never {
  revalidatePath("/brand");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

async function fileOf(form: FormData) {
  const f = form.get("file");
  return f instanceof File && f.size ? { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) } : null;
}

const details = z.object({ name: text(120), type: text(20), tags: text(400), usageNotes: text(2000), version: text(40), url: text(1000) });

export async function createAssetAction(form: FormData) {
  const user = await requireCan("brand:manage");
  const p = details.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const r = await createAsset(db, user.id, p, await fileOf(form));
  go(r.ok ? `/brand/assets/${r.id}` : "/brand/assets/new", r, "Added to the library");
}

export async function updateAssetAction(form: FormData) {
  const user = await requireCan("brand:manage");
  const p = details.extend({ id }).parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  go(`/brand/assets/${p.id}`, await updateAsset(db, user.id, p.id, p), "Saved");
}

export async function newVersionAction(form: FormData) {
  const user = await requireCan("brand:manage");
  const p = z.object({ id, version: text(40), usageNotes: text(2000), url: text(1000) }).parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  const r = await newVersion(db, user.id, p.id, { version: p.version || null, usageNotes: p.usageNotes || null, url: p.url || null }, await fileOf(form));
  go(r.ok ? `/brand/assets/${r.id}` : `/brand/assets/${p.id}`, r, "New version added; the old one is retired");
}

export async function retireAssetAction(form: FormData) {
  const user = await requireCan("brand:manage");
  const a = id.parse(form.get("id"));
  const restore = form.get("restore") === "1";
  go(`/brand/assets/${a}`, await setRetired(db, user.id, a, !restore), restore ? "Back in the library" : "Retired: it no longer shows in the library");
}
