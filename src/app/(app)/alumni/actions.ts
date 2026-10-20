"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { AVAILABILITY, graduate, revokeCertificate, saveAlumniProfile, saveRules } from "@/lib/graduation";
import { can } from "@/lib/rbac";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

export async function saveRulesAction(form: FormData) {
  const user = await requireCan("programme:write");
  const cohortId = id.parse(form.get("cohortId"));
  const r = await saveRules(db, cohortId, { gradMinAttendancePct: Number(form.get("gradMinAttendancePct")), gradRequireAllPassed: form.get("gradRequireAllPassed") === "on", gradRequirePaid: form.get("gradRequirePaid") === "on" }, user.id);
  revalidatePath(`/cohorts/${cohortId}/graduation`);
  done(`/cohorts/${cohortId}/graduation`, r, "Graduation rules saved");
}

// Instructors graduate students who meet the rules; only owners can override a rule, with a reason.
export async function graduateAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z.object({ enrolmentId: id, cohortId: id, override: z.string().max(300).optional() }).parse(Object.fromEntries(form));
  const r = await graduate(db, p.enrolmentId, user.id, { override: p.override, canOverride: can(user.role, "settings:write") });
  revalidatePath(`/cohorts/${p.cohortId}/graduation`);
  done(`/cohorts/${p.cohortId}/graduation`, r, r.ok ? `Graduated. Certificate ${r.code}` : "");
}

export async function revokeCertificateAction(form: FormData) {
  const user = await requireCan("settings:write");
  const p = z.object({ code: z.string().max(20), reason: z.string().max(300), back: z.string().max(200).optional() }).parse(Object.fromEntries(form));
  const r = await revokeCertificate(db, p.code, p.reason, user.id);
  const to = safePath(p.back, "/alumni");
  revalidatePath(to);
  done(to, r, "Certificate revoked");
}

export async function saveAlumniAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z
    .object({ leadId: id, headline: z.string().max(300).optional(), skills: z.string().max(1000).optional(), availability: z.enum(Object.keys(AVAILABILITY) as [keyof typeof AVAILABILITY]), portfolioUrl: z.string().max(600).optional(), notes: z.string().max(4000).optional(), back: z.string().max(200).optional() })
    .parse(Object.fromEntries(form));
  const r = await saveAlumniProfile(db, p.leadId, { ...p, skills: (p.skills ?? "").split(",") }, user.id);
  const to = safePath(p.back, "/alumni");
  revalidatePath(to);
  done(to, r, "Profile saved");
}
