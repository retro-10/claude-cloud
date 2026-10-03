"use server";

import { db } from "@/db";
import { AiError, aiStatus } from "@/lib/ai/core";
import { draftCaption, draftConsultBrief, draftLeadMessage, draftScript, draftWeekly } from "@/lib/ai/drafts";
import { requireCan } from "@/lib/server-auth";

export type DraftResult = { ok: true; text: string } | { ok: false; error: string };

// Drafts come back to the page to be edited; nothing here sends, posts or saves the text.
async function run(make: (v: { id: number; name: string; role: Awaited<ReturnType<typeof requireCan>>["role"] }, ai: Extract<Awaited<ReturnType<typeof aiStatus>>, { ok: true }>["settings"]) => Promise<string>): Promise<DraftResult> {
  const user = await requireCan("ai:use");
  const status = await aiStatus(db);
  if (!status.ok) return { ok: false, error: status.reason };
  try {
    return { ok: true, text: await make({ id: user.id, name: user.name, role: user.role }, status.settings) };
  } catch (e) {
    return { ok: false, error: e instanceof AiError ? e.message : "Something went wrong. Try again." };
  }
}

export async function draftLeadMessageAction(leadId: number, form: FormData) {
  return run((v, ai) => draftLeadMessage(db, v, leadId, { lang: form.get("lang"), kind: form.get("kind") }, ai));
}
export async function draftCaptionAction(contentId: number, form: FormData) {
  return run((v, ai) => draftCaption(db, v, contentId, { lang: form.get("lang") }, ai));
}
export async function draftScriptAction(campaignId: number, form: FormData) {
  return run((v, ai) => draftScript(db, v, campaignId, { lang: form.get("lang"), minutes: form.get("minutes") }, ai));
}
export async function draftWeeklyAction(weekStart: string, _form: FormData) {
  return run((v, ai) => draftWeekly(db, v, weekStart, ai));
}
export async function draftBriefAction(leadId: number, _form: FormData) {
  return run((v, ai) => draftConsultBrief(db, v, leadId, ai));
}
