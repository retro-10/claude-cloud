"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { syncNow } from "@/lib/notion/sync";
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
