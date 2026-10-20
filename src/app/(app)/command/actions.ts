"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { saveReview } from "@/lib/command";
import { requireCan } from "@/lib/server-auth";

const text = z.string().max(8000).optional();

// The owners' weekly review. Saving also stores that week's numbers with it.
export async function saveReviewAction(form: FormData) {
  const user = await requireCan("settings:write");
  const p = z.object({ week: z.string().max(10), wins: text, misses: text, decisions: text, notes: text }).parse(Object.fromEntries(form));
  const r = await saveReview(db, p.week, p, user.id);
  revalidatePath("/command");
  redirect(r.ok ? `/command?week=${p.week}&notice=${encodeURIComponent("Weekly review saved")}#review` : `/command?error=${encodeURIComponent(r.error)}#review`);
}
