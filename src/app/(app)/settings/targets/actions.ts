"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireCan } from "@/lib/server-auth";
import { TARGET_KEYS, isPeriod, saveTarget } from "@/lib/targets";

// One form per quarter: every metric's box is saved; an empty box clears that target.
export async function saveTargetsAction(form: FormData) {
  const user = await requireCan("settings:write");
  const period = form.get("period");
  if (!isPeriod(period)) redirect("/settings/targets?error=" + encodeURIComponent("Unknown quarter"));
  for (const metric of TARGET_KEYS) {
    const raw = String(form.get(metric) ?? "").replace(/[,\s]/g, "");
    if (raw && !/^\d{1,10}$/.test(raw)) redirect("/settings/targets?error=" + encodeURIComponent("Targets are whole numbers"));
    const r = await saveTarget(db, metric, period as string, raw ? Number(raw) : null, user.id);
    if (!r.ok) redirect("/settings/targets?error=" + encodeURIComponent(r.error));
  }
  revalidatePath("/", "layout");
  redirect(`/settings/targets?notice=${encodeURIComponent(`Targets for ${period} saved`)}`);
}
