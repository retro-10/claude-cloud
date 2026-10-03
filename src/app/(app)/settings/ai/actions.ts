"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { requireCan } from "@/lib/server-auth";

export async function saveAiSettingsAction(form: FormData) {
  const user = await requireCan("settings:write");
  const on = (k: string) => form.get(k) === "on";
  const r = await saveSettings(
    db,
    {
      ai: {
        enabled: on("enabled"),
        readLeads: on("readLeads"),
        readMoney: on("readMoney"),
        readStudents: on("readStudents"),
        readProduction: on("readProduction"),
        brandVoice: String(form.get("brandVoice") ?? "").slice(0, 2000),
        dailyLimit: Number(form.get("dailyLimit")),
      },
    },
    user.id,
  );
  revalidatePath("/settings/ai");
  redirect(r.ok ? "/settings/ai?notice=Saved" : `/settings/ai?error=${encodeURIComponent("The daily limit is 1 to 2,000 requests; keep the brand voice under 2,000 characters")}`);
}
