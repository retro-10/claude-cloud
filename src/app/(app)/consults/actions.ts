"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { bookConsult, markConsult, rescheduleConsult } from "@/lib/consults";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const id = z.coerce.number().int().positive();
const when = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const fail = (leadId: number, msg: string) => redirect(`/leads/${leadId}?error=${encodeURIComponent(msg)}`);

export async function bookConsultAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ leadId: id, when, notes: z.string().max(5000).optional() }).parse(Object.fromEntries(form));
  const at = cairoLocalToDate(p.when);
  if (!at) fail(p.leadId, "Invalid consult date");
  await bookConsult(db, { leadId: p.leadId, scheduledAt: at!, notes: p.notes }, user.id);
  revalidatePath(`/leads/${p.leadId}`);
  revalidatePath("/");
}

export async function markConsultAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z
    .object({
      consultId: id,
      leadId: id,
      result: z.enum(["held", "no_show"]),
      outcome: z.enum(["enrolled", "thinking", "not_fit"]).optional().or(z.literal("")),
      notes: z.string().max(5000).optional(),
    })
    .parse(Object.fromEntries(form));
  const objectionIds = form.getAll("objectionIds").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const r = await markConsult(
    db,
    { consultId: p.consultId, result: p.result, outcome: p.outcome || null, objectionIds, notes: p.notes },
    user.id,
  );
  revalidatePath(`/leads/${p.leadId}`);
  revalidatePath("/");
  if (!r.ok) fail(p.leadId, r.error);
}

export async function rescheduleConsultAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ consultId: id, leadId: id, when }).parse(Object.fromEntries(form));
  const at = cairoLocalToDate(p.when);
  if (at) await rescheduleConsult(db, p.consultId, at, user.id);
  revalidatePath(`/leads/${p.leadId}`);
  revalidatePath("/");
}
