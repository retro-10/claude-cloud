"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { saveTeamMember } from "@/lib/programme";
import { requireCan } from "@/lib/server-auth";

// Owners only: the team list decides who costs can be paid to (and is copied to Notion's Team database).
export async function saveTeamMemberAction(form: FormData) {
  const user = await requireCan("settings:write");
  const p = z
    .object({
      id: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable()),
      name: z.string().max(200),
      role: z.string().max(80).optional(),
      group: z.string().max(40).optional(),
      status: z.string().max(40).optional(),
      contact: z.string().max(200).optional(),
      duties: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  const r = p.success ? await saveTeamMember(db, p.data.id, p.data, user.id) : { ok: false as const, error: "Check the details." };
  revalidatePath("/settings/team");
  redirect(`/settings/team?${r.ok ? `notice=${encodeURIComponent(p.data?.id ? "Saved" : "Team member added")}` : `error=${encodeURIComponent(r.error)}`}`);
}
