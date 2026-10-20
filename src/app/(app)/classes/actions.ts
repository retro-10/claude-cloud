"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { ATTENDANCE, MISSED_FOR_CHECK_IN, copySchedule, deleteClass, markAttendance, saveClass, type AttendanceStatus } from "@/lib/classes";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const blank = (v: unknown) => (v === "" || v == null ? null : v);
const optId = z.preprocess(blank, z.coerce.number().int().positive().nullable());
const id = z.coerce.number().int().positive();

function done(to: string, r: { ok: true } | { ok: false; error: string }, notice: string): never {
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

export async function saveClassAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z
    .object({
      id: optId,
      cohortId: id,
      title: z.string().max(400),
      module: z.string().max(200).optional(),
      startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      durationMin: z.coerce.number().int(),
      instructorId: optId,
      location: z.string().max(400).optional(),
      recordingUrl: z.string().max(600).optional(),
      materialsUrl: z.string().max(600).optional(),
      notes: z.string().max(4000).optional(),
    })
    .safeParse(Object.fromEntries(form));
  const back = safePath(form.get("back"), "/classes");
  if (!p.success) done(back, { ok: false, error: "Check the date, time and length" }, "");
  const r = await saveClass(db, p.data.id, { ...p.data, startsAt: cairoLocalToDate(p.data.startsAt)! }, user.id);
  revalidatePath("/classes");
  done(r.ok ? `/classes/${r.id}` : back, r, p.data.id ? "Class saved" : "Class added");
}

export async function deleteClassAction(form: FormData) {
  const user = await requireCan("programme:write");
  await deleteClass(db, id.parse(form.get("id")), user.id);
  revalidatePath("/classes");
  done("/classes", { ok: true }, "Class removed");
}

export async function copyScheduleAction(form: FormData) {
  const user = await requireCan("programme:write");
  const p = z.object({ fromCohortId: id, toCohortId: id, firstDay: z.string().max(10) }).parse(Object.fromEntries(form));
  const r = await copySchedule(db, p.fromCohortId, p.toCohortId, p.firstDay, user.id);
  revalidatePath("/classes");
  done(`/classes?batch=${p.toCohortId}`, r, r.ok ? `Copied ${r.copied} classes` : "");
}

// One form per class: each student posts st-<enrolmentId> = present | late | absent | excused | (empty)
export async function markAttendanceAction(form: FormData) {
  const user = await requireCan("programme:write");
  const classId = id.parse(form.get("classId"));
  const marks = [...form.keys()]
    .filter((k) => /^st-\d+$/.test(k))
    .map((k) => {
      const v = String(form.get(k) ?? "");
      return { enrolmentId: Number(k.slice(3)), status: (v in ATTENDANCE ? v : null) as AttendanceStatus | null };
    });
  const r = await markAttendance(db, classId, marks, user.id);
  revalidatePath(`/classes/${classId}`);
  done(`/classes/${classId}`, r, r.ok ? `Attendance saved${r.checkIns ? `; ${r.checkIns} check-in task${r.checkIns === 1 ? "" : "s"} made for students who missed ${MISSED_FOR_CHECK_IN}+ classes` : ""}` : "");
}
