"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  MAX_BODY,
  archiveChannel,
  chatLink,
  createChannel,
  deleteMessage,
  editMessage,
  joinChannel,
  leaveChannel,
  openDm,
  postMessage,
  updateChannel,
} from "@/lib/chat";
import { can } from "@/lib/rbac";
import type { Result } from "@/lib/result";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const body = z.string().max(MAX_BODY * 2); // trimmed and checked again in lib/chat
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

const me = (user: { id: number; role: Parameters<typeof can>[0] }) => ({ id: user.id, isOwner: can(user.role, "settings:write") });

function go(to: string, r: Result, notice?: string): never {
  revalidatePath("/", "layout");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? (notice ? `${to}${sep}notice=${encodeURIComponent(notice)}` : to) : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

// The open conversation calls these directly and polls for the result, so they return instead of redirecting.

export async function sendMessageAction(input: { channelId: number; body: string }): Promise<Result<{ id?: number }>> {
  const user = await requireCan("chat:write");
  const p = z.object({ channelId: id, body }).safeParse(input);
  if (!p.success) return { ok: false, error: `Messages can be up to ${MAX_BODY} characters` };
  return postMessage(db, user, p.data.channelId, p.data.body);
}

export async function editMessageAction(input: { id: number; body: string }): Promise<Result> {
  const user = await requireCan("chat:write");
  const p = z.object({ id, body }).safeParse(input);
  if (!p.success) return { ok: false, error: `Messages can be up to ${MAX_BODY} characters` };
  return editMessage(db, me(user), p.data.id, p.data.body);
}

export async function deleteMessageAction(input: { id: number }): Promise<Result> {
  const user = await requireCan("chat:write");
  return deleteMessage(db, me(user), id.parse(input.id));
}

// Forms: channels and DMs.

export async function createChannelAction(form: FormData) {
  const user = await requireCan("chat:write");
  const p = z.object({ name: text(80), topic: text(200) }).parse(Object.fromEntries(form));
  const r = await createChannel(db, user.id, p);
  go(r.ok ? chatLink(r.id) : "/chat/new", r, "Channel created");
}

export async function updateChannelAction(form: FormData) {
  const user = await requireCan("chat:write");
  const p = z.object({ id, name: text(80), topic: text(200) }).parse(Object.fromEntries(form));
  go(chatLink(p.id), await updateChannel(db, me(user), p.id, p), "Channel updated");
}

export async function archiveChannelAction(form: FormData) {
  const user = await requireCan("chat:write");
  const channelId = id.parse(form.get("id"));
  const restore = form.get("restore") === "1";
  const r = await archiveChannel(db, me(user), channelId, !restore);
  go(r.ok && !restore ? "/chat" : chatLink(channelId), r, restore ? "Channel restored" : "Channel archived");
}

export async function joinChannelAction(form: FormData) {
  const user = await requireCan("chat:write");
  const channelId = id.parse(form.get("id"));
  go(chatLink(channelId), await joinChannel(db, user.id, channelId));
}

export async function leaveChannelAction(form: FormData) {
  const user = await requireCan("chat:write");
  const channelId = id.parse(form.get("id"));
  const r = await leaveChannel(db, user.id, channelId);
  go(r.ok ? "/chat" : chatLink(channelId), r, "You left the channel");
}

export async function openDmAction(form: FormData) {
  const user = await requireCan("chat:write");
  const people = z.array(id).max(20).parse(form.getAll("people"));
  const r = await openDm(db, user.id, people);
  go(r.ok ? chatLink(r.id) : "/chat/new?tab=dm", r);
}
