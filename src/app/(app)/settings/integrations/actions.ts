"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { moveFilesToDrive } from "@/lib/attachments";
import { runBackup } from "@/lib/backup";
import { removeDemoData } from "@/lib/demo-cleanup";
import { disconnectDrive } from "@/lib/drive";
import { archiveNotionPages, syncNow } from "@/lib/notion/sync";
import { requireCan } from "@/lib/server-auth";

// Runs one sync and waits for it (a few seconds for a normal day's changes), then shows the result.
export async function syncNotionAction() {
  const user = await requireCan("settings:write");
  const run = syncNow(db);
  if (!run) redirect("/settings/integrations?error=" + encodeURIComponent("Notion is not connected: set NOTION_TOKEN on the server."));
  await audit(db, { userId: user.id, entity: "notion", action: "sync_now" });
  const r = await run!;
  revalidatePath("/", "layout");
  const msg = `Synced: ${r.pushed} sent, ${r.pulled} updated from Notion, ${r.created} new${r.conflicts ? `, ${r.conflicts} conflicts` : ""}${r.more ? " (more next run)" : ""}`;
  redirect(`/settings/integrations?${r.errors.length ? "error" : "notice"}=${encodeURIComponent(r.errors.length ? `${msg}. ${r.errors.length} problem(s) below.` : msg)}`);
}

// Owners only: deletes the demo leads, batches and DEMO money rows so only real data (and Notion's) remains.
export async function removeDemoAction() {
  const user = await requireCan("settings:write");
  const r = await removeDemoData(db, user.id);
  // their Notion pages go too, so Notion shows only real data and never sends them back
  const n = await archiveNotionPages(r.notionPages);
  revalidatePath("/", "layout");
  const msg = `Demo data removed (${r.leads} demo leads${n.archived ? `, ${n.archived} Notion pages archived` : ""})`;
  if (n.failed) redirect(`/settings/integrations?error=${encodeURIComponent(`${msg}. ${n.failed} Notion page(s) could not be archived; delete them in Notion by hand.`)}`);
  redirect(`/settings/integrations?notice=${encodeURIComponent(msg)}`);
}

// Moves up to 50 files kept in the database across to Google Drive now (the 5-minute tick moves the rest).
export async function moveFilesToDriveAction() {
  const user = await requireCan("settings:write");
  const r = await moveFilesToDrive(db, 50);
  await audit(db, { userId: user.id, entity: "google_drive", action: "move_files", diff: r });
  revalidatePath("/settings/integrations");
  if (r.error) redirect(`/settings/integrations?error=${encodeURIComponent(`${r.moved} file(s) moved. ${r.error}`)}`);
  redirect(`/settings/integrations?notice=${encodeURIComponent(r.moved ? `${r.moved} file(s) moved to Google Drive` : "No files left to move")}`);
}

export async function disconnectDriveAction() {
  const user = await requireCan("settings:write");
  await disconnectDrive(db, user.id);
  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations?notice=${encodeURIComponent("Google Drive disconnected. New files are kept in the database.")}`);
}

export async function backupNowAction() {
  const user = await requireCan("settings:write");
  const r = await runBackup(db, user.id);
  revalidatePath("/settings/integrations");
  redirect(`/settings/integrations?${r.ok ? "notice" : "error"}=${encodeURIComponent(r.ok ? `Backup saved to Drive: ${r.name}` : r.error)}`);
}
