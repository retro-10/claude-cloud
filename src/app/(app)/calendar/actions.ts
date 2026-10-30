"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { allDayRange, cancelEvent, clockIn, clockOut, deleteEntry, endAux, hours, saveEntry, saveEvent, startAux } from "@/lib/calendar";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { cairoLocalToDate } from "@/lib/time";

const id = z.coerce.number().int().positive();
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const local = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable());
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));

function done(form: FormData, result: { ok: true } | { ok: false; error: string }, notice: string) {
  const back = safePath(form.get("back"), "/calendar");
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(result.ok ? `${back}${sep}notice=${encodeURIComponent(notice)}` : `${back}${sep}error=${encodeURIComponent(result.error)}`);
}

export async function clockInAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await clockIn(db, user.id, text(300).parse(form.get("note")));
  done(form, r, "Clocked in. Have a good session");
}

export async function clockOutAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await clockOut(db, user.id, text(300).parse(form.get("note")));
  done(form, r, r.ok ? `Clocked out: ${hours(r.minutes)} logged` : "");
}

/** Step away (break, prayer, lunch …) while clocked in. */
export async function startAuxAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await startAux(db, user.id, text(30).parse(form.get("code")));
  done(form, r, r.ok ? `${r.label}: the clock shows you as away` : "");
}

export async function endAuxAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await endAux(db, user.id);
  done(form, r, r.ok ? `Back to work after ${r.label.toLowerCase()} (${hours(r.minutes)})` : "");
}

/** Add or fix hours by hand. Times are Cairo wall time from datetime-local inputs. */
export async function saveHoursAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const p = z.object({ id: optId, userId: optId, start: local, end: local, note: text(300) }).parse(Object.fromEntries(form));
  const r = await saveEntry(
    db,
    user,
    p.id,
    { userId: p.userId ?? user.id, start: p.start ? cairoLocalToDate(p.start) : null, end: p.end ? cairoLocalToDate(p.end) : null, note: p.note },
  );
  done(form, r, p.id ? "Hours saved" : "Hours added");
}

export async function deleteHoursAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await deleteEntry(db, user, id.parse(form.get("id")));
  done(form, r, "Hours removed");
}

export async function saveEventAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const p = z
    .object({
      id: optId,
      userId: optId,
      title: text(300),
      kind: z.string().max(30),
      start: local,
      end: local,
      allDay: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
      note: text(1000),
    })
    .parse(Object.fromEntries(form));
  // all-day: whole Cairo days from the start date to the end date (an empty end means one day)
  const range =
    p.allDay && p.start
      ? allDayRange(p.start.slice(0, 10), (p.end ?? p.start).slice(0, 10))
      : { start: p.start ? cairoLocalToDate(p.start) : null, end: p.end ? cairoLocalToDate(p.end) : null };
  const r = await saveEvent(db, user, p.id, { userId: p.userId ?? user.id, title: p.title, kind: p.kind, allDay: p.allDay, note: p.note, ...range });
  done(form, r, p.id ? "Event saved" : "Added to the calendar");
}

export async function cancelEventAction(form: FormData) {
  const user = await requireCan("calendar:write");
  const r = await cancelEvent(db, user, id.parse(form.get("id")));
  done(form, r, "Event removed");
}
