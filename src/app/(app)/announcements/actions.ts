"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { acknowledge, announcementLink, publish, setArchived, setPinned } from "@/lib/announcements";
import type { Result } from "@/lib/result";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

function go(to: string, r: Result, notice: string): never {
  revalidatePath("/", "layout");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

export async function publishAnnouncementAction(form: FormData) {
  const user = await requireCan("comms:post");
  const p = z.object({ title: text(200), body: text(20_000) }).parse({ title: form.get("title"), body: form.get("body") });
  const r = await publish(db, user, { ...p, audience: form.getAll("audience").map(String), pinned: form.get("pinned") === "on", mustAck: form.get("mustAck") === "on" });
  go(r.ok ? announcementLink(r.id) : "/announcements/new", r, r.ok ? `Sent to ${r.people} ${r.people === 1 ? "person" : "people"}` : "");
}

export async function acknowledgeAction(form: FormData) {
  const user = await requireCan("comms:read");
  const a = id.parse(form.get("id"));
  go(announcementLink(a), await acknowledge(db, user.id, a), "Thank you: acknowledged");
}

export async function archiveAnnouncementAction(form: FormData) {
  const user = await requireCan("comms:post");
  const a = id.parse(form.get("id"));
  const restore = form.get("restore") === "1";
  go(restore ? announcementLink(a) : "/announcements", await setArchived(db, user.id, a, !restore), restore ? "Restored" : "Archived");
}

export async function pinAnnouncementAction(form: FormData) {
  const user = await requireCan("comms:post");
  const a = id.parse(form.get("id"));
  const pinned = form.get("pinned") === "1";
  go(announcementLink(a), await setPinned(db, user.id, a, pinned), pinned ? "Pinned to the top" : "Unpinned");
}
