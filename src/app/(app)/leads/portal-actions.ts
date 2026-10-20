"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { createInvite, setPortalActive } from "@/lib/portal";
import { publicBaseUrl } from "@/lib/public-url";
import { requireCan } from "@/lib/server-auth";

export type InviteState = { error?: string; link?: string };

// The invite link is shown once, here, to send on WhatsApp; only its hash is stored.
export async function createInviteAction(_prev: InviteState, form: FormData): Promise<InviteState> {
  const user = await requireCan("programme:write");
  const leadId = z.coerce.number().int().positive().parse(form.get("leadId"));
  const r = await createInvite(db, leadId, user.id);
  revalidatePath(`/leads/${leadId}`);
  if (!r.ok) return { error: r.error };
  return { link: `${await publicBaseUrl()}/portal/invite/${r.token}` };
}

export async function setPortalActiveAction(form: FormData) {
  const user = await requireCan("programme:write");
  const leadId = z.coerce.number().int().positive().parse(form.get("leadId"));
  await setPortalActive(db, leadId, form.get("active") === "on", user.id);
  revalidatePath(`/leads/${leadId}`);
}
