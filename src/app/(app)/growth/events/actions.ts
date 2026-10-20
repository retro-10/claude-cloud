"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { addRegistrant, eventLeadIds, followUpAfterEvent, markReminded, setAttendance } from "@/lib/events";
import { normalizePhone } from "@/lib/phone";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const back = (campaignId: number, msg: { notice?: string; error?: string }) =>
  redirect(`/growth/events/${campaignId}?${msg.error ? `error=${encodeURIComponent(msg.error)}` : `notice=${encodeURIComponent(msg.notice ?? "Saved")}`}`);

export async function addRegistrantAction(form: FormData) {
  const user = await requireCan("growth:write");
  const campaignId = id.parse(form.get("campaignId"));
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (!phone) back(campaignId, { error: "Type their WhatsApp number" });
  const [l] = await db.select({ id: leads.id }).from(leads).where(eq(leads.phoneWhatsapp, phone!));
  if (!l) back(campaignId, { error: "No lead with that number yet: add them as a lead first (New lead), then here" });
  const r = await addRegistrant(db, campaignId, l!.id, user.id);
  revalidatePath(`/growth/events/${campaignId}`);
  back(campaignId, r.ok ? { notice: "Registered" } : { error: r.error });
}

export async function markRemindedAction(form: FormData) {
  const user = await requireCan("growth:write");
  const campaignId = id.parse(form.get("campaignId"));
  const [leadId] = await eventLeadIds(db, campaignId, [Number(form.get("leadId"))]);
  if (!leadId) back(campaignId, { error: "That person is not registered for this event" });
  await markReminded(db, campaignId, leadId, user.id);
  revalidatePath(`/growth/events/${campaignId}`);
  back(campaignId, { notice: "Marked as reminded (logged as a WhatsApp sent)" });
}

// One form for the whole list: each row posts att-<leadId> = yes | no | (empty: not marked)
export async function saveAttendanceAction(form: FormData) {
  const user = await requireCan("growth:write");
  const campaignId = id.parse(form.get("campaignId"));
  const posted = [...form.keys()].filter((k) => /^att-\d+$/.test(k)).map((k) => Number(k.slice(4)));
  const ok = new Set(await eventLeadIds(db, campaignId, posted));
  const marks = posted.filter((l) => ok.has(l)).map((leadId) => {
    const v = form.get(`att-${leadId}`);
    return { leadId, attended: v === "yes" ? true : v === "no" ? false : null };
  });
  await setAttendance(db, campaignId, marks, user.id);
  revalidatePath(`/growth/events/${campaignId}`);
  back(campaignId, { notice: `Attendance saved for ${marks.length} ${marks.length === 1 ? "person" : "people"}` });
}

export async function followUpEventAction(form: FormData) {
  const user = await requireCan("growth:write");
  const p = z.object({ campaignId: id, templateId: id, who: z.enum(["attended", "no_show"]) }).parse(Object.fromEntries(form));
  const r = await followUpAfterEvent(db, p.campaignId, p.who, p.templateId, user.id);
  revalidatePath(`/growth/events/${p.campaignId}`);
  back(p.campaignId, { notice: `Cadence started for ${r.done}${r.skipped ? `, skipped ${r.skipped} (${[...new Set(r.reasons)].join("; ")})` : ""}` });
}
