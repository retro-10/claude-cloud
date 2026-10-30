import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db";
import { calendarEvents, notifications, timeAux, timeEntries, users } from "@/db/schema";
import { getSetting } from "./app-settings";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { can, type Role } from "./rbac";
import { type Result, clean } from "./result";
import { addDaysYmd, cairoLocalToDate, cairoYmd, startOfCairoDay, startOfNextCairoDay } from "./time";

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

/**
 * A clock is never left running past the day it started: it stops at the next midnight (Cairo). Reads apply the
 * same rule, so totals are right even before the sweep has written it down.
 */
export const effectiveEnd = (e: { startedAt: Date; endedAt: Date | null }, now: Date) =>
  e.endedAt ?? new Date(Math.min(now.getTime(), startOfNextCairoDay(e.startedAt).getTime()));

/**
 * Stops every clock still running from an earlier day, at the midnight after it started, and tells the person in
 * their inbox so they can fix the hours. Runs every few minutes and before anyone clocks in.
 */
export async function stopForgottenClocks(db: Db, now = new Date()): Promise<number> {
  const stale = await db
    .select({ id: timeEntries.id, userId: timeEntries.userId, startedAt: timeEntries.startedAt })
    .from(timeEntries)
    .where(and(isNull(timeEntries.endedAt), lt(timeEntries.startedAt, startOfCairoDay(now))));
  let n = 0;
  for (const e of stale) {
    const endedAt = startOfNextCairoDay(e.startedAt);
    const done = await db
      .update(timeEntries)
      .set({ endedAt, autoStopped: true, updatedAt: now })
      .where(and(eq(timeEntries.id, e.id), isNull(timeEntries.endedAt)))
      .returning({ id: timeEntries.id });
    if (!done.length) continue; // clocked out meanwhile
    await db.update(timeAux).set({ endedAt }).where(and(eq(timeAux.entryId, e.id), isNull(timeAux.endedAt)));
    n++;
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(e.startedAt);
    await db.insert(notifications).values({
      userId: e.userId,
      kind: "clock_auto_stopped",
      title: `You did not clock out on ${day}: the clock stopped at midnight (${hours((endedAt.getTime() - e.startedAt.getTime()) / 60_000)}). Fix it in Team calendar > My time if that is wrong.`,
    });
    await audit(db, { userId: null, entity: "time_entry", entityId: e.id, action: "auto_stop", diff: { for: e.userId } });
  }
  return n;
}

export async function openEntry(db: Db, userId: number) {
  const [e] = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt)));
  return e ?? null;
}

export async function clockIn(db: Db, userId: number, note?: string | null, now = new Date()): Promise<Result<{ id: number }>> {
  await stopForgottenClocks(db, now);
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
  const endedAt = now < open.startedAt ? open.startedAt : effectiveEnd(open, now);
  const n = clean(note, 300);
  await db
    .update(timeEntries)
    .set({ endedAt, note: n ?? open.note, updatedAt: now })
    .where(eq(timeEntries.id, open.id));
  await db.update(timeAux).set({ endedAt }).where(and(eq(timeAux.entryId, open.id), isNull(timeAux.endedAt)));
  await audit(db, { userId, entity: "time_entry", entityId: open.id, action: "clock_out" });
  const away = await unpaidAuxMinutes(db, [{ ...open, endedAt }], open.startedAt, endedAt, now);
  return { ok: true, minutes: (endedAt.getTime() - open.startedAt.getTime()) / 60_000 - away };
}

// ---------------- away statuses (AUX) ----------------

type AuxRow = typeof timeAux.$inferSelect;
type EntryLike = { id: number; startedAt: Date; endedAt: Date | null };

/** When an away status ends: when it was ended, else now, and never after its clock stopped. */
const auxEnd = (a: AuxRow, entry: EntryLike, now: Date) => {
  const clockEnd = effectiveEnd(entry, now);
  return a.endedAt && a.endedAt < clockEnd ? a.endedAt : clockEnd;
};

export async function openAux(db: Db, userId: number) {
  const [a] = await db.select().from(timeAux).where(and(eq(timeAux.userId, userId), isNull(timeAux.endedAt)));
  return a ?? null;
}

/** Step away (break, prayer, lunch …) while clocked in. Switching from one status to another ends the first. */
export async function startAux(db: Db, userId: number, code: string, now = new Date()): Promise<Result<{ id: number; label: string }>> {
  const open = await openEntry(db, userId);
  if (!open || effectiveEnd(open, now) < now) return { ok: false, error: "Clock in first" };
  const def = (await getSetting(db, "auxCodes")).find((c) => c.key === code);
  if (!def) return { ok: false, error: "That status is not in the list any more" };
  const current = await openAux(db, userId);
  if (current?.code === code) return { ok: true, id: current.id, label: current.label };
  if (current) await db.update(timeAux).set({ endedAt: now }).where(eq(timeAux.id, current.id));
  try {
    const [row] = await db.insert(timeAux).values({ entryId: open.id, userId, code, label: def.label, paid: def.paid, startedAt: now }).returning({ id: timeAux.id });
    await audit(db, { userId, entity: "time_aux", entityId: row.id, action: "start", diff: { code } });
    return { ok: true, id: row.id, label: def.label };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "You already have a status running" }; // two clicks at once
    throw e;
  }
}

/** Back to work: ends the running away status. */
export async function endAux(db: Db, userId: number, now = new Date()): Promise<Result<{ minutes: number; label: string }>> {
  const a = await openAux(db, userId);
  if (!a) return { ok: false, error: "You are not away" };
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, a.entryId));
  const raw = entry ? auxEnd({ ...a, endedAt: now }, entry, now) : now;
  const end = raw < a.startedAt ? a.startedAt : raw;
  await db.update(timeAux).set({ endedAt: end }).where(eq(timeAux.id, a.id));
  await audit(db, { userId, entity: "time_aux", entityId: a.id, action: "end" });
  return { ok: true, minutes: (end.getTime() - a.startedAt.getTime()) / 60_000, label: a.label };
}

/** Away stretches of these clock entries, each clipped to its entry and to [from, to). */
async function auxWithin(db: Db, entries: EntryLike[], from: Date, to: Date, now: Date) {
  if (!entries.length) return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rows = await db.select().from(timeAux).where(inArray(timeAux.entryId, [...byId.keys()]));
  return rows
    .map((a) => ({
      ...a,
      start: new Date(Math.max(a.startedAt.getTime(), from.getTime())),
      end: new Date(Math.min(auxEnd(a, byId.get(a.entryId)!, now).getTime(), to.getTime())),
    }))
    .filter((a) => a.end > a.start);
}

async function unpaidAuxMinutes(db: Db, entries: EntryLike[], from: Date, to: Date, now: Date) {
  return (await auxWithin(db, entries, from, to, now)).filter((a) => !a.paid).reduce((n, a) => n + (a.end.getTime() - a.start.getTime()) / 60_000, 0);
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
  await db.delete(timeAux).where(eq(timeAux.entryId, id));
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
    .select({ id: timeEntries.id, userId: timeEntries.userId, startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
    .from(timeEntries)
    .where(and(lt(timeEntries.startedAt, to), or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from))));
  // unpaid away time comes off the hours, on the day it happened
  const away = (await auxWithin(db, rows, from, to, now)).filter((a) => !a.paid);
  const bounds = Array.from({ length: days }, (_, i) => {
    const ymd = addDaysYmd(firstYmd, i);
    return { ymd, ...daysRange(ymd, 1) };
  });
  const out = new Map<number, Map<string, number>>();
  const add = (userId: number, start: Date, end: Date, sign: 1 | -1) => {
    for (const b of bounds) {
      const ms = Math.min(end.getTime(), b.to.getTime()) - Math.max(start.getTime(), b.from.getTime());
      if (ms <= 0) continue;
      const m = out.get(userId) ?? new Map<string, number>();
      m.set(b.ymd, (m.get(b.ymd) ?? 0) + (sign * ms) / 60_000);
      out.set(userId, m);
    }
  };
  for (const r of rows) add(r.userId, r.startedAt, effectiveEnd(r, now), 1);
  for (const a of away) add(a.userId, a.start, a.end, -1);
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
  state: "working" | "aux" | "away" | "busy" | "off";
  since: Date | null; // clocked in at
  aux: { label: string; since: Date; over: boolean } | null; // on a break, at prayer, at lunch …
  current: CalEvent | null; // what they are in right now
  next: CalEvent | null; // the next thing today
  todayMinutes: number;
};

/** Everyone active, and what they are doing now: working (clocked in), in an event, away, or not working. */
export async function presence(db: Db, now = new Date()): Promise<Presence[]> {
  const today = cairoYmd(now);
  const { from, to } = daysRange(today, 1);
  const [people, open, events, worked, auxOpen, codes] = await Promise.all([
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(timeEntries).where(isNull(timeEntries.endedAt)),
    listEvents(db, from, to),
    workedByDay(db, today, 1, now),
    db.select().from(timeAux).where(isNull(timeAux.endedAt)),
    getSetting(db, "auxCodes"),
  ]);
  return people.map((p) => {
    const mine = events.filter((e) => e.userId === p.id);
    const current = mine.find((e) => e.startsAt <= now && e.endsAt > now) ?? null;
    const next = mine.find((e) => e.startsAt > now) ?? null;
    const clock = open.find((o) => o.userId === p.id && effectiveEnd(o, now) >= now);
    const away = current && kindOf(current.kind).away;
    const a = clock ? auxOpen.find((x) => x.entryId === clock.id) : undefined;
    const max = a ? codes.find((c) => c.key === a.code)?.maxMinutes : null;
    const aux = a ? { label: a.label, since: a.startedAt, over: !!max && now.getTime() - a.startedAt.getTime() > max * 60_000 } : null;
    const state: Presence["state"] = away ? "away" : clock ? (aux ? "aux" : current ? "busy" : "working") : current ? "busy" : "off";
    return { ...p, state, since: clock?.startedAt ?? null, aux, current, next, todayMinutes: worked.get(p.id)?.get(today) ?? 0 };
  });
}

/** For the top bar: is this person's clock running, and since when. */
export async function clockState(db: Db, userId: number, now = new Date()) {
  const e = await openEntry(db, userId);
  if (!e || effectiveEnd(e, now) < now) return { running: false as const, since: null, aux: null };
  const a = await openAux(db, userId);
  return { running: true as const, since: e.startedAt, aux: a && a.entryId === e.id ? { code: a.code, label: a.label, since: a.startedAt } : null };
}

// ---------------- payroll export ----------------

export type HoursRow = {
  person: string;
  email: string;
  role: string;
  date: string;
  start: Date;
  end: Date;
  minutes: number; // worked: the stretch less its unpaid away time
  clockMinutes: number; // the whole stretch, clock in to clock out
  away: Record<string, number>; // minutes per away status, paid or not
  note: string | null;
  autoStopped: boolean;
  running: boolean;
};

/**
 * Every stretch of work in a month (Cairo calendar), clipped to the month, with each person's total. For payroll:
 * a running clock counts up to now and is marked as such; clocks stopped at midnight are marked too.
 */
export async function monthHours(db: Db, month: string, now = new Date()) {
  const from = cairoLocalToDate(`${month}-01T00:00`)!;
  const [y, m] = month.split("-").map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const to = cairoLocalToDate(`${next}-01T00:00`)!;
  const rows = await db
    .select({ e: timeEntries, person: users.name, email: users.email, role: users.role })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(lt(timeEntries.startedAt, to), or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from))))
    .orderBy(asc(users.name), asc(timeEntries.startedAt));
  const aux = await auxWithin(db, rows.map((r) => r.e), from, to, now);
  const detail: HoursRow[] = rows.map(({ e, person, email, role }) => {
    const start = e.startedAt < from ? from : e.startedAt;
    const rawEnd = effectiveEnd(e, now);
    const end = rawEnd > to ? to : rawEnd;
    const clockMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60_000);
    const away: Record<string, number> = {};
    let unpaid = 0;
    for (const a of aux.filter((x) => x.entryId === e.id)) {
      const m = (a.end.getTime() - a.start.getTime()) / 60_000;
      away[a.label] = (away[a.label] ?? 0) + m;
      if (!a.paid) unpaid += m;
    }
    return { person, email, role, date: cairoYmd(start), start, end, minutes: Math.max(0, clockMinutes - unpaid), clockMinutes, away, note: e.note, autoStopped: e.autoStopped, running: !e.endedAt && rawEnd >= now };
  });
  type Total = { person: string; email: string; role: string; minutes: number; clockMinutes: number; away: Record<string, number>; days: Set<string>; stretches: number; autoStopped: number };
  const totals = new Map<string, Total>();
  for (const r of detail) {
    const t = totals.get(r.email) ?? { person: r.person, email: r.email, role: r.role, minutes: 0, clockMinutes: 0, away: {}, days: new Set<string>(), stretches: 0, autoStopped: 0 };
    t.minutes += r.minutes;
    t.clockMinutes += r.clockMinutes;
    for (const [k, m] of Object.entries(r.away)) t.away[k] = (t.away[k] ?? 0) + m;
    t.days.add(r.date);
    t.stretches++;
    if (r.autoStopped) t.autoStopped++;
    totals.set(r.email, t);
  }
  return { detail, summary: [...totals.values()].map((t) => ({ ...t, days: t.days.size })) };
}
