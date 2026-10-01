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
import { resetTwoFactor } from "@/lib/two-factor";
import { eq } from "drizzle-orm";
import { workflowRules, type RuleAction } from "@/db/schema";
import { getSettings, saveSettings, type Route } from "@/lib/app-settings";
import { CHECK_KEYS, type CheckKey } from "@/lib/exit-criteria";
import { saveMessageTemplate, setTemplateActive } from "@/lib/message-templates";
import { createStage, setCriterion } from "@/lib/settings";
import { deleteRule, saveRule, setRuleEnabled, type RuleInput } from "@/lib/workflows";

const id = z.coerce.number().int().positive();
const role = z.enum(["owner", "sales", "viewer", "finance", "instructor"]);
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

// Lost phone: clears someone's two-factor so they can sign in with the password and set it up again.
// Not for yourself: turning your own off needs a current code (My account).
export async function resetTwoFactorAction(form: FormData) {
  const me = await requireCan("users:manage");
  const p = z.object({ id }).safeParse(Object.fromEntries(form));
  if (!p.success) bad("/settings/users");
  if (p.data!.id === me.id) redirect(`/settings/users?error=${encodeURIComponent("Turn your own two-factor off in My account")}`);
  await resetTwoFactor(db, p.data!.id, me.id);
  revalidatePath("/settings/users");
  redirect(`/settings/users?notice=${encodeURIComponent("Two-factor reset: they sign in with their password and set it up again")}`);
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
    (await cookies()).delete(SESSION_COOKIE);
    redirect("/login");
  }
  done("/account", r);
}

// ---- Release 1.1: thresholds, assignment, stages and exit criteria, workflow rules, message templates ----

const num = (form: FormData, k: string) => Number(form.get(k));

export async function saveThresholdsAction(form: FormData) {
  const me = await requireCan("settings:write");
  const days = form.getAll("whDays").map(Number).filter((d) => Number.isInteger(d));
  const r = await saveSettings(
    db,
    {
      neglectDays: num(form, "neglectDays"),
      staleDays: num(form, "staleDays"),
      slaTargetMin: num(form, "slaTargetMin"),
      slaAmberMin: num(form, "slaAmberMin"),
      slaRedMin: num(form, "slaRedMin"),
      decisionDueDays: num(form, "decisionDueDays"),
      maxOpenStages: num(form, "maxOpenStages"),
      workingHours: { enabled: form.get("whEnabled") === "on", start: String(form.get("whStart")), end: String(form.get("whEnd")), days },
    },
    me.id,
  );
  revalidatePath("/", "layout");
  done("/settings/rules", r);
}

export async function saveAssignmentAction(form: FormData) {
  const me = await requireCan("settings:write");
  const def = String(form.get("defaultOwnerId") ?? "");
  const routes = [0, 1, 2, 3, 4, 5]
    .map((i) => ({ field: String(form.get(`field_${i}`) ?? ""), value: String(form.get(`value_${i}`) ?? "").trim(), userId: Number(form.get(`user_${i}`)) }))
    .filter((r) => (r.field === "source" || r.field === "segment") && r.value && Number.isInteger(r.userId) && r.userId > 0) as Route[];
  done("/settings/rules", await saveSettings(db, { defaultOwnerId: /^\d+$/.test(def) ? Number(def) : null, routes }, me.id));
}

export async function createStageAction(form: FormData) {
  const me = await requireCan("settings:write");
  const label = z.string().max(100).parse(form.get("label") ?? "");
  const s = await getSettings(db);
  const r = await createStage(db, label, s.maxOpenStages, me.id);
  revalidatePath("/pipeline");
  revalidatePath("/settings/pipeline");
  if (!r.ok) redirect(`/settings/pipeline?error=${encodeURIComponent(r.error)}`);
  redirect(`/settings/pipeline?notice=${encodeURIComponent(r.warning ?? "Stage added")}`);
}

export async function setCriterionAction(form: FormData) {
  const me = await requireCan("settings:write");
  const stageKey = z.string().min(1).max(50).parse(form.get("stageKey"));
  const checkKey = z.enum(CHECK_KEYS as [CheckKey, ...CheckKey[]]).parse(form.get("checkKey"));
  done("/settings/pipeline", await setCriterion(db, stageKey, checkKey, form.get("required") === "1", me.id));
}

function ruleFromForm(form: FormData): RuleInput {
  const conditions: Record<string, string> = {};
  for (const k of ["to_stage", "result", "outcome", "segment", "source", "tier", "overdue_hours"]) {
    const v = String(form.get(`c_${k}`) ?? "").trim();
    if (v) conditions[k] = v;
  }
  const type = String(form.get("a_type") ?? "");
  const text = String(form.get("a_text") ?? "").trim();
  const minutes = Number(form.get("a_minutes") ?? 0);
  let action: RuleAction;
  if (type === "notify") action = { type: "notify", title: text };
  else if (type === "add_tag") action = { type: "add_tag", tag: text.toLowerCase() };
  else if (type === "apply_cadence") action = { type: "apply_cadence", cadence: text };
  else if (type === "cancel_follow_ups") action = { type: "cancel_follow_ups" };
  else action = { type: "create_follow_up", kind: String(form.get("a_kind") || "whatsapp"), note: text, dueInMinutes: minutes };
  return { name: String(form.get("name") ?? ""), trigger: String(form.get("trigger") ?? ""), conditions, actions: [action] };
}

export async function createRuleAction(form: FormData) {
  const me = await requireCan("settings:write");
  done("/settings/workflows", await saveRule(db, null, ruleFromForm(form), me.id));
}

// Built-in rules: name and follow-up wording/delay are editable; their shape (trigger, actions) stays.
export async function editRuleAction(form: FormData) {
  const me = await requireCan("settings:write");
  const ruleId = id.parse(form.get("id"));
  const [cur] = await db.select().from(workflowRules).where(eq(workflowRules.id, ruleId));
  if (!cur) bad("/settings/workflows");
  const actions = cur!.actions.map((a, i): RuleAction => {
    const note = String(form.get(`note_${i}`) ?? "").trim();
    const mins = form.get(`minutes_${i}`);
    if (a.type === "create_follow_up") return { ...a, note: note || a.note, ...(a.dueAt ? {} : { dueInMinutes: mins === null ? a.dueInMinutes : Number(mins) }) };
    if (a.type === "notify") return { ...a, title: note || a.title };
    return a;
  });
  const conditions = { ...cur!.conditions };
  const hours = form.get("overdue_hours");
  if (hours !== null) conditions.overdue_hours = String(hours);
  done("/settings/workflows", await saveRule(db, ruleId, { name: String(form.get("name") ?? cur!.name), trigger: cur!.trigger, conditions, actions }, me.id));
}

export async function toggleRuleAction(form: FormData) {
  const me = await requireCan("settings:write");
  await setRuleEnabled(db, id.parse(form.get("id")), form.get("enabled") === "1", me.id);
  done("/settings/workflows", { ok: true });
}

export async function deleteRuleAction(form: FormData) {
  const me = await requireCan("settings:write");
  done("/settings/workflows", await deleteRule(db, id.parse(form.get("id")), me.id));
}

export async function saveMessageTemplateAction(form: FormData) {
  const me = await requireCan("settings:write");
  const tplId = /^\d+$/.test(String(form.get("id") ?? "")) ? Number(form.get("id")) : null;
  const t = { name: String(form.get("name") ?? ""), category: String(form.get("category") ?? ""), language: String(form.get("language") ?? ""), body: String(form.get("body") ?? "") };
  done("/settings/templates", await saveMessageTemplate(db, tplId, t, me.id));
}

export async function archiveMessageTemplateAction(form: FormData) {
  const me = await requireCan("settings:write");
  await setTemplateActive(db, id.parse(form.get("id")), form.get("active") === "1", me.id);
  done("/settings/templates", { ok: true });
}
