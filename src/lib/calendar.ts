import { and, asc, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db";
import { calendarEvents, timeEntries, users } from "@/db/schema";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { can, type Role } from "./rbac";
import { type Result, clean } from "./result";
import { addDaysYmd, cairoLocalToDate, cairoYmd } from "./time";

// The team calendar: who is working right now (clock in / clock out), how many hours each person put in, and
// what everyone has planned (meetings, focus time, days off) so the others can see when they are free.

export type Actor = { id: number; role: Role };
/** Owners (people who manage users) can fix anyone's hours and calendar; everyone else only their own. */
const mayActFor = (actor: Actor, userId: number) => actor.id === userId || can(actor.role, "users:manage");

export const EVENT_KINDS = [
  { key: "meeting", label: "Meeting", color: "brand", away: false },
  { key: "busy", label: "Busy", color: "warn", away: false },
  { key: "focus", label: "Focus time", color: "info", away: false },
  { key: "out_of_office", label: "Out of office", color: "pink", away: true },
  { key: "leave", label: "Day off / leave", color: "danger", away: true },
  { key: "other", label: "Other", color: "slate", away: false },
] as const;
export type EventKind = (typeof EVENT_KINDS)[number]["key"];
export const kindOf = (k: string) => EVENT_KINDS.find((x) => x.key === k) ?? EVENT_KINDS[5];

/** "7h 05m" */
export function hours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The Monday (Cairo calendar) of the week a day falls in. */
export function mondayOf(ymd: string): string {
  const weekday = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysYmd(ymd, -weekday);
}

/** The instants a run of Cairo days covers: [start of the first day, start of the day after the last). */
export function daysRange(firstYmd: string, days: number) {
  return { from: cairoLocalToDate(`${firstYmd}T00:00`)!, to: cairoLocalToDate(`${addDaysYmd(firstYmd, days)}T00:00`)! };
}

async function activeUser(db: Db, id: number) {
  const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, id));
  return !!u?.active;
}

// ---------------- clock in / clock out ----------------

export async function openEntry(db: Db, userId: number) {
  const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt)));
  return e ?? null;
}

export async function clockIn(db: Db, userId: number, note?: string | null, now = new Date()): Promise<Result<{ id: number }>> {
  if (await openEntry(db, userId)) return { ok: false, error: "You are already clocked in" };
  try {
    const [row] = await db.insert(timeEntries).values({ userId, startedAt: now, note: clean(note, 300) }).returning({ id: timeEntries.id });
    await audit(db, { userId, entity: "time_entry", entityId: row.id, action: "clock_in" });
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "You are already clocked in" }; // two clicks at once
    throw e;
  }
}

export async function clockOut(db: Db, userId: number, note?: string | null, now = new Date()): Promise<Result<{ minutes: number }>> {
  const open = await openEntry(db, userId);
  if (!open) return { ok: false, error: "You are not clocked in" };
  const endedAt = now < open.startedAt ? open.startedAt : now;
  const n = clean(note, 300);
  await db
    .update(timeEntries)
    .set({ endedAt, note: n ?? open.note, updatedAt: now })
    .where(eq(timeEntries.id, open.id));
  await audit(db, { userId, entity: "time_entry", entityId: open.id, action: "clock_out" });
  return { ok: true, minutes: (endedAt.getTime() - open.startedAt.getTime()) / 60_000 };
}

export type EntryInput = { userId: number; start: Date | null; end: Date | null; note?: string | null };

/**
 * Add or fix a stretch of work by hand (forgot to clock out, worked away from the laptop). It must end after it
 * starts, not lie in the future and not overlap the person's other hours. Leaving the end empty is only allowed
 * for the stretch that is still running.
 */
export async function saveEntry(db: Db, actor: Actor, id: number | null, input: EntryInput, now = new Date()): Promise<Result<{ id: number }>> {
  if (!mayActFor(actor, input.userId)) return { ok: false, error: "You can only change your own hours" };
  if (!input.start) return { ok: false, error: "Give the start time" };
  const before = id ? (await db.select().from(timeEntries).where(eq(timeEntries.id, id)))[0] : null;
  if (id && !before) return { ok: false, error: "Entry not found" };
  if (before && !mayActFor(actor, before.userId)) return { ok: false, error: "You can only change your own hours" };
  if (before && before.userId !== input.userId) return { ok: false, error: "An entry cannot move to another person" };
  if (!input.end && !(before && !before.endedAt)) return { ok: false, error: "Give the end time (use Clock in for work that is still going on)" };
  if (input.start > now || (input.end && input.end > now)) return { ok: false, error: "Hours cannot be in the future" };
  if (input.end && input.end <= input.start) return { ok: false, error: "The end must be after the start" };
  if (input.end && input.end.getTime() - input.start.getTime() > 24 * 3_600_000) return { ok: false, error: "One entry covers at most 24 hours: split it per day" };
  if (!(await activeUser(db, input.userId))) return { ok: false, error: "Pick an active team member" };
  const end = input.end ?? now;
  const [clash] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, input.userId),
        id ? ne(timeEntries.id, id) : undefined,
        lt(timeEntries.startedAt, end),
        or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, input.start)),
      ),
    )
    .limit(1);
  if (clash) return { ok: false, error: "That overlaps other hours already logged" };
  const values = { userId: input.userId, startedAt: input.start, endedAt: input.end, note: clean(input.note, 300), updatedAt: now };
  if (before) {
    await db.update(timeEntries).set(values).where(eq(timeEntries.id, before.id));
    await audit(db, { userId: actor.id, entity: "time_entry", entityId: before.id, action: "update", diff: { for: input.userId } });
    return { ok: true, id: before.id };
  }
  const [row] = await db.insert(timeEntries).values(values).returning({ id: timeEntries.id });
  await audit(db, { userId: actor.id, entity: "time_entry", entityId: row.id, action: "create", diff: { for: input.userId } });
  return { ok: true, id: row.id };
}

export async function deleteEntry(db: Db, actor: Actor, id: number): Promise<Result> {
  const [e] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
  if (!e) return { ok: false, error: "Entry not found" };
  if (!mayActFor(actor, e.userId)) return { ok: false, error: "You can only change your own hours" };
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
  await audit(db, { userId: actor.id, entity: "time_entry", entityId: id, action: "delete", diff: { for: e.userId, startedAt: e.startedAt, endedAt: e.endedAt } });
  return { ok: true };
}

export async function listEntries(db: Db, userId: number, from: Date, to: Date) {
  return db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), lt(timeEntries.startedAt, to), or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from))))
    .orderBy(desc(timeEntries.startedAt));
}

/**
 * Minutes worked per person per Cairo day over a range of days. A stretch that crosses midnight counts on each
 * day for the part inside it; a running clock counts up to now.
 */
export async function workedByDay(db: Db, firstYmd: string, days: number, now = new Date()): Promise<Map<number, Map<string, number>>> {
  const { from, to } = daysRange(firstYmd, days);
  const rows = await db
    .select({ userId: timeEntries.userId, startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
    .from(timeEntries)
    .where(and(lt(timeEntries.startedAt, to), or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from))));
  const bounds = Array.from({ length: days }, (_, i) => {
    const ymd = addDaysYmd(firstYmd, i);
    return { ymd, ...daysRange(ymd, 1) };
  });
  const out = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const end = r.endedAt ?? now;
    for (const b of bounds) {
      const ms = Math.min(end.getTime(), b.to.getTime()) - Math.max(r.startedAt.getTime(), b.from.getTime());
      if (ms <= 0) continue;
      const m = out.get(r.userId) ?? new Map<string, number>();
      m.set(b.ymd, (m.get(b.ymd) ?? 0) + ms / 60_000);
      out.set(r.userId, m);
    }
  }
  return out;
}

// ---------------- events ----------------

export type EventInput = { userId: number; title: string; kind: string; start: Date | null; end: Date | null; allDay: boolean; note?: string | null };

/** All-day events run from the first day's midnight to the midnight after the last day (Cairo). */
export function allDayRange(startYmd: string, endYmd: string) {
  return { start: cairoLocalToDate(`${startYmd}T00:00`), end: cairoLocalToDate(`${addDaysYmd(endYmd, 1)}T00:00`) };
}

export async function saveEvent(db: Db, actor: Actor, id: number | null, input: EventInput): Promise<Result<{ id: number }>> {
  if (!mayActFor(actor, input.userId)) return { ok: false, error: "You can only plan your own calendar" };
  const title = clean(input.title, 120);
  if (!title) return { ok: false, error: "Give the event a title" };
  if (!EVENT_KINDS.some((k) => k.key === input.kind)) return { ok: false, error: "Pick what kind of event it is" };
  if (!input.start || !input.end) return { ok: false, error: "Give the start and the end" };
  if (input.end <= input.start) return { ok: false, error: "The end must be after the start" };
  if (input.end.getTime() - input.start.getTime() > 62 * 86_400_000) return { ok: false, error: "Keep one event under two months" };
  if (!(await activeUser(db, input.userId))) return { ok: false, error: "Pick an active team member" };
  const values = { userId: input.userId, title, kind: input.kind as EventKind, startsAt: input.start, endsAt: input.end, allDay: input.allDay, note: clean(input.note, 500) };
  if (id) {
    const [before] = await db.select().from(calendarEvents).where(and(eq(calendarEvents.id, id), isNull(calendarEvents.cancelledAt)));
    if (!before) return { ok: false, error: "Event not found" };
    if (!mayActFor(actor, before.userId)) return { ok: false, error: "You can only plan your own calendar" };
    await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, id));
    await audit(db, { userId: actor.id, entity: "calendar_event", entityId: id, action: "update" });
    return { ok: true, id };
  }
  const [row] = await db.insert(calendarEvents).values({ ...values, createdBy: actor.id }).returning({ id: calendarEvents.id });
  await audit(db, { userId: actor.id, entity: "calendar_event", entityId: row.id, action: "create", diff: { for: input.userId } });
  return { ok: true, id: row.id };
}

export async function cancelEvent(db: Db, actor: Actor, id: number): Promise<Result> {
  const [e] = await db.select().from(calendarEvents).where(and(eq(calendarEvents.id, id), isNull(calendarEvents.cancelledAt)));
  if (!e) return { ok: false, error: "Event not found" };
  if (!mayActFor(actor, e.userId)) return { ok: false, error: "You can only plan your own calendar" };
  await db.update(calendarEvents).set({ cancelledAt: new Date() }).where(eq(calendarEvents.id, id));
  await audit(db, { userId: actor.id, entity: "calendar_event", entityId: id, action: "cancel" });
  return { ok: true };
}

export type CalEvent = typeof calendarEvents.$inferSelect & { person: string };

export async function listEvents(db: Db, from: Date, to: Date, userId?: number): Promise<CalEvent[]> {
  const rows = await db
    .select({ e: calendarEvents, person: users.name })
    .from(calendarEvents)
    .innerJoin(users, eq(users.id, calendarEvents.userId))
    .where(and(isNull(calendarEvents.cancelledAt), lt(calendarEvents.startsAt, to), gt(calendarEvents.endsAt, from), userId ? eq(calendarEvents.userId, userId) : undefined))
    .orderBy(asc(calendarEvents.startsAt));
  return rows.map(({ e, person }) => ({ ...e, person }));
}

export async function getEvent(db: Db, id: number): Promise<CalEvent | null> {
  const [r] = await db
    .select({ e: calendarEvents, person: users.name })
    .from(calendarEvents)
    .innerJoin(users, eq(users.id, calendarEvents.userId))
    .where(and(eq(calendarEvents.id, id), isNull(calendarEvents.cancelledAt)));
  return r ? { ...r.e, person: r.person } : null;
}

/** Does an event touch a Cairo day? */
export const onDay = (e: { startsAt: Date; endsAt: Date }, ymd: string) => {
  const { from, to } = daysRange(ymd, 1);
  return e.startsAt < to && e.endsAt > from;
};

// ---------------- right now ----------------

export type Presence = {
  id: number;
  name: string;
  role: Role;
  state: "working" | "away" | "busy" | "off";
  since: Date | null; // clocked in at
  current: CalEvent | null; // what they are in right now
  next: CalEvent | null; // the next thing today
  todayMinutes: number;
};

/** Everyone active, and what they are doing now: working (clocked in), in an event, away, or not working. */
export async function presence(db: Db, now = new Date()): Promise<Presence[]> {
  const today = cairoYmd(now);
  const { from, to } = daysRange(today, 1);
  const [people, open, events, worked] = await Promise.all([
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(timeEntries).where(isNull(timeEntries.endedAt)),
    listEvents(db, from, to),
    workedByDay(db, today, 1, now),
  ]);
  return people.map((p) => {
    const mine = events.filter((e) => e.userId === p.id);
    const current = mine.find((e) => e.startsAt <= now && e.endsAt > now) ?? null;
    const next = mine.find((e) => e.startsAt > now) ?? null;
    const clock = open.find((o) => o.userId === p.id);
    const away = current && kindOf(current.kind).away;
    const state: Presence["state"] = away ? "away" : clock ? (current ? "busy" : "working") : current ? "busy" : "off";
    return { ...p, state, since: clock?.startedAt ?? null, current, next, todayMinutes: worked.get(p.id)?.get(today) ?? 0 };
  });
}

/** For the top bar: is this person's clock running, and since when. */
export async function clockState(db: Db, userId: number) {
  const e = await openEntry(db, userId);
  return e ? { running: true as const, since: e.startedAt } : { running: false as const, since: null };
}
