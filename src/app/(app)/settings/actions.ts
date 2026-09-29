"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { SESSION_COOKIE } from "@/lib/session";
import {
  addCampaign,
  addListItem,
  changeOwnPassword,
  createUser,
  deleteCampaign,
  deleteListItem,
  deleteTemplate,
  moveStage,
  renameCampaign,
  renameListItem,
  renameStage,
  resetPassword,
  saveTemplate,
  updateUser,
  type ListName,
  type Result,
} from "@/lib/settings";
import { requireCan, requireUser } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const role = z.enum(["owner", "sales", "viewer", "finance"]);
const list = z.enum(["sources", "lostReasons", "objections"]);

// Every mutation here returns to the page it came from with either a notice or an error.
function done(path: string, r: Result): never {
  revalidatePath(path);
  redirect(r.ok ? `${path}?notice=Saved` : `${path}?error=${encodeURIComponent(r.error)}`);
}
const bad = (path: string): never => redirect(`${path}?error=${encodeURIComponent("Check the fields and try again.")}`);

// ---- users (owner only) ----

export async function createUserAction(form: FormData) {
  const me = await requireCan("users:manage");
  const p = z.object({ name: z.string().trim().min(1).max(100), email: z.string().max(200), role, password: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/users");
  done("/settings/users", await createUser(db, p.data!, me.id));
}

export async function updateUserAction(form: FormData) {
  const me = await requireCan("users:manage");
  const p = z.object({ id, role, name: z.string().trim().min(1).max(100), active: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/users");
  done("/settings/users", await updateUser(db, p.data!.id, { role: p.data!.role, name: p.data!.name, active: p.data!.active === "on" }, me.id));
}

export async function resetPasswordAction(form: FormData) {
  const me = await requireCan("users:manage");
  const p = z.object({ id, password: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/users");
  done("/settings/users", await resetPassword(db, p.data!.id, p.data!.password, me.id));
}

// ---- pipeline stages ----

export async function renameStageAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ key: z.string().min(1).max(50), label: z.string().max(100) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/pipeline");
  done("/settings/pipeline", await renameStage(db, p.data!.key, p.data!.label, me.id));
}

export async function moveStageAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ key: z.string().min(1).max(50), direction: z.enum(["up", "down"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/pipeline");
  const r = await moveStage(db, p.data!.key, p.data!.direction, me.id);
  revalidatePath("/pipeline");
  done("/settings/pipeline", r);
}

// ---- lists: sources, lost reasons, objection tags, campaigns ----

export async function addListItemAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ list, label: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  done("/settings/lists", await addListItem(db, p.data!.list as ListName, p.data!.label, me.id));
}

export async function renameListItemAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ list, id, label: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  done("/settings/lists", await renameListItem(db, p.data!.list as ListName, p.data!.id, p.data!.label, me.id));
}

export async function deleteListItemAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ list, id }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  done("/settings/lists", await deleteListItem(db, p.data!.list as ListName, p.data!.id, me.id));
}

export async function addCampaignAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ label: z.string().max(200), sourceId: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  const src = p.data!.sourceId && /^\d+$/.test(p.data!.sourceId) ? Number(p.data!.sourceId) : null;
  done("/settings/lists", await addCampaign(db, p.data!.label, src, me.id));
}

export async function renameCampaignAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ id, label: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  done("/settings/lists", await renameCampaign(db, p.data!.id, p.data!.label, me.id));
}

export async function deleteCampaignAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ id }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/lists");
  done("/settings/lists", await deleteCampaign(db, p.data!.id, me.id));
}

// ---- cadence templates ----

export async function saveTemplateAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ id: z.string().optional(), name: z.string().max(200), steps: z.string().max(10_000) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/cadences");
  const tplId = p.data!.id && /^\d+$/.test(p.data!.id) ? Number(p.data!.id) : null;
  done("/settings/cadences", await saveTemplate(db, tplId, p.data!.name, p.data!.steps, me.id));
}

export async function deleteTemplateAction(form: FormData) {
  const me = await requireCan("settings:write");
  const p = z.object({ id }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/cadences");
  done("/settings/cadences", await deleteTemplate(db, p.data!.id, me.id));
}

// ---- own account (any signed-in user) ----

export async function changePasswordAction(form: FormData) {
  const me = await requireUser();
  const p = z.object({ current: z.string().max(200), next: z.string().max(200), confirm: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/account");
  if (p.data!.next !== p.data!.confirm) redirect(`/account?error=${encodeURIComponent("The new passwords do not match")}`);
  const r = await changeOwnPassword(db, me.id, p.data!.current, p.data!.next);
  // the session cookie carries the old password fingerprint, so sign in again with the new one
  if (r.ok) {
    cookies().delete(SESSION_COOKIE);
    redirect("/login");
  }
  done("/account", r);
}
