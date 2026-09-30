"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { createCohort, updateCohort } from "@/lib/cohorts";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const id = z.coerce.number().int().positive();
const optDate = z
  .string()
  .optional()
  .transform((v) => (v ? cairoLocalToDate(v) : null));
const cohortSchema = z.object({
  name: z.string().trim().min(1).max(120),
  seatCap: z.coerce.number().int().min(1).max(10_000),
  masterclassAt: optDate,
  enrolmentCloseAt: optDate,
  startAt: optDate,
  openAt: optDate,
  status: z.enum(["planning", "live", "closed"]).optional(),
});

const err = (path: string, msg: string) => redirect(`${path}?error=${encodeURIComponent(msg)}`);

export async function createCohortAction(form: FormData) {
  const user = await requireCan("settings:write");
  const p = cohortSchema.safeParse(Object.fromEntries(form));
  if (!p.success) err("/cohorts", "Check the name and seat cap.");
  const c = await createCohort(db, p.data!, user.id);
  revalidatePath("/cohorts");
  redirect(`/cohorts/${c.id}`);
}

export async function updateCohortAction(form: FormData) {
  const user = await requireCan("settings:write");
  const cohortId = id.parse(form.get("id"));
  const path = `/cohorts/${cohortId}`;
  const p = cohortSchema.safeParse(Object.fromEntries(form));
  if (!p.success) err(path, "Check the name and seat cap.");
  const r = await updateCohort(db, cohortId, p.data!, user.id);
  revalidatePath(path);
  if (!r.ok) err(path, r.error);
  redirect(path);
}
