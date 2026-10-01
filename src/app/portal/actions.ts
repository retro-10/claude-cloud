"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assignments, enrolments } from "@/db/schema";
import { recordSubmission } from "@/lib/assignments";
import { addAttachment } from "@/lib/attachments";
import { audit } from "@/lib/audit";
import { acceptInvite, studentLogin } from "@/lib/portal";
import { clearHits, isLimited, rateLimit, recordHit } from "@/lib/rate-limit";
import { STUDENT_COOKIE, signStudent, studentCookieOptions } from "@/lib/session";
import { requireStudent } from "@/lib/student-auth";

export type PortalState = { error?: string; done?: string };

const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const MAX_FAILED = Number(process.env.LOGIN_MAX_FAILED_PER_ACCOUNT ?? 5);

// Public: the portal's sign-in. Failed tries are limited per number and address, like staff sign-in.
export async function portalLogin(_prev: PortalState, form: FormData): Promise<PortalState> {
  const phone = String(form.get("phone") ?? "").slice(0, 40);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!phone || !password) return { error: "Enter your WhatsApp number and password. · أدخل رقم الواتساب وكلمة المرور" };
  const key = `portal:${await ip()}:${phone.replace(/\D/g, "").slice(-9)}`;
  const WINDOW = 15 * 60_000;
  if (isLimited(key, MAX_FAILED, WINDOW).limited) return { error: "Too many tries. Wait a few minutes. · محاولات كثيرة، انتظر قليلًا" };
  const s = await studentLogin(db, phone, password);
  if (!s) {
    recordHit(key, WINDOW);
    return { error: "Wrong number or password. · الرقم أو كلمة المرور غير صحيحة" };
  }
  clearHits(key);
  (await cookies()).set(STUDENT_COOKIE, await signStudent(s.accountId, s.pv), studentCookieOptions());
  await audit(db, { userId: null, entity: "portal", entityId: s.leadId, action: "login" });
  redirect("/portal");
}

// Public: setting the password from a one-time invite. The token is the check.
export async function acceptInviteAction(_prev: PortalState, form: FormData): Promise<PortalState> {
  if (!rateLimit(`portal-invite:${await ip()}`, 20, 10 * 60_000).ok) return { error: "Too many tries. Wait a few minutes." };
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords are not the same. · كلمتا المرور غير متطابقتين" };
  const r = await acceptInvite(db, String(form.get("token") ?? ""), password);
  if (!r.ok) return { error: r.error };
  (await cookies()).set(STUDENT_COOKIE, await signStudent(r.accountId, r.pv), studentCookieOptions());
  redirect("/portal");
}

export async function portalLogout() {
  (await cookies()).delete({ name: STUDENT_COOKIE, path: "/portal" });
  redirect("/portal/login");
}

// A student sends their work. The enrolment comes from their session, never from the form.
export async function submitWorkAction(_prev: PortalState, form: FormData): Promise<PortalState> {
  const me = await requireStudent();
  if (!rateLimit(`portal-upload:${me.accountId}`, 20, 10 * 60_000).ok) return { error: "Too many uploads. Wait a few minutes." };
  const p = z.object({ assignmentId: z.coerce.number().int().positive(), link: z.string().max(600).optional(), note: z.string().max(2000).optional() }).safeParse({
    assignmentId: form.get("assignmentId"),
    link: form.get("link") ?? undefined,
    note: form.get("note") ?? undefined,
  });
  if (!p.success) return { error: "Please try again." };
  const [mine] = await db
    .select({ enrolmentId: enrolments.id })
    .from(assignments)
    .innerJoin(enrolments, and(eq(enrolments.cohortId, assignments.cohortId), eq(enrolments.leadId, me.leadId), sql`${enrolments.status} <> 'dropped'`))
    .where(eq(assignments.id, p.data.assignmentId));
  if (!mine) return { error: "This assignment is not in your batch." };
  let attachmentId: number | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size) {
    const a = await addAttachment(db, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { leadId: me.leadId, note: "Sent from the student portal" }, null);
    if (!a.ok) return { error: a.error };
    attachmentId = a.id;
  }
  const r = await recordSubmission(db, p.data.assignmentId, mine.enrolmentId, { attachmentId, link: p.data.link, note: p.data.note }, { userId: null, student: true });
  if (!r.ok) return { error: r.error };
  return { done: r.attempt > 1 ? `Sent again (attempt ${r.attempt}). We will review it soon.` : "Sent. We will review it soon. · تم الإرسال" };
}
