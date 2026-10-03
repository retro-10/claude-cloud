"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { ask, deleteThread } from "@/lib/ai/ask";
import { AiError, aiStatus } from "@/lib/ai/core";
import { requireCan } from "@/lib/server-auth";

export async function askAction(form: FormData) {
  const user = await requireCan("ai:use");
  const t = Number(form.get("threadId")) || null;
  const back = t ? `/ask?t=${t}` : "/ask";
  const status = await aiStatus(db);
  if (!status.ok) redirect(`${back}${t ? "&" : "?"}error=${encodeURIComponent(status.reason)}`);
  let id: number;
  try {
    id = (await ask(db, { id: user.id, name: user.name, role: user.role }, t, String(form.get("question") ?? ""), status.settings)).threadId;
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "Something went wrong. Try again.";
    redirect(`${back}${t ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/ask");
  redirect(`/ask?t=${id}`);
}

export async function deleteThreadAction(form: FormData) {
  const user = await requireCan("ai:use");
  await deleteThread(db, user.id, Number(form.get("threadId")));
  revalidatePath("/ask");
  redirect("/ask?notice=Conversation+deleted");
}
