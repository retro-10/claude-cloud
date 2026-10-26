import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  allDayRange,
  cancelEvent,
  clockIn,
  clockOut,
  deleteEntry,
  hours,
  listEntries,
  listEvents,
  mondayOf,
  presence,
  saveEntry,
  saveEvent,
  workedByDay,
} from "@/lib/calendar";
import { createUser } from "@/lib/settings";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const at = (local: string) => cairoLocalToDate(local)!;

d("team calendar: clock in and out, hours, events, who is free", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: { id: number; role: "owner" }, mona: { id: number; role: "sales" }, omar: { id: number; role: "designer" };

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    const [o] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, "owner")).limit(1);
    owner = { id: o.id, role: "owner" };
    const m = await createUser(db, { name: "Mona", email: "mona@cal.local", role: "sales", password: "long enough pw" }, null);
    const d2 = await createUser(db, { name: "Omar", email: "omar@cal.local", role: "designer", password: "long enough pw" }, null);
    if (!m.ok || !d2.ok) throw new Error("users");
    mona = { id: m.id, role: "sales" };
    omar = { id: d2.id, role: "designer" };
  });
  afterAll(() => client.end());

  it("clock in once, clock out once; the minutes are counted", async () => {
    const t0 = at("2026-10-26T09:00");
    expect(await clockIn(db, mona.id, "Morning calls", t0)).toMatchObject({ ok: true });
    expect(await clockIn(db, mona.id, null, at("2026-10-26T09:05"))).toEqual({ ok: false, error: "You are already clocked in" });
    expect(await clockOut(db, mona.id, null, at("2026-10-26T12:30"))).toEqual({ ok: true, minutes: 210 });
    expect(await clockOut(db, mona.id, null, at("2026-10-26T12:31"))).toMatchObject({ ok: false });
    const [e] = await listEntries(db, mona.id, at("2026-10-26T00:00"), at("2026-10-27T00:00"));
    expect(e).toMatchObject({ note: "Morning calls" });
  });

  it("manual hours: must end after they start, not in the future, not overlap, and only your own", async () => {
    const now = at("2026-10-26T18:00");
    const base = { userId: mona.id, note: "Workshop" };
    expect(await saveEntry(db, mona, null, { ...base, start: at("2026-10-26T14:00"), end: at("2026-10-26T13:00") }, now)).toMatchObject({ ok: false, error: expect.stringContaining("after") });
    expect(await saveEntry(db, mona, null, { ...base, start: at("2026-10-26T17:00"), end: at("2026-10-26T19:00") }, now)).toMatchObject({ ok: false, error: expect.stringContaining("future") });
    expect(await saveEntry(db, mona, null, { ...base, start: at("2026-10-26T12:00"), end: at("2026-10-26T13:00") }, now)).toMatchObject({ ok: false, error: expect.stringContaining("overlaps") });
    expect(await saveEntry(db, mona, null, { ...base, start: at("2026-10-26T14:00"), end: null }, now)).toMatchObject({ ok: false, error: expect.stringContaining("end time") });
    expect(await saveEntry(db, omar, null, { ...base, start: at("2026-10-26T14:00"), end: at("2026-10-26T16:00") }, now)).toMatchObject({ ok: false, error: expect.stringContaining("own") });
    const r = await saveEntry(db, mona, null, { ...base, start: at("2026-10-26T14:00"), end: at("2026-10-26T16:00") }, now);
    expect(r).toMatchObject({ ok: true });
    // an owner can fix it; Omar cannot delete it
    if (!r.ok) return;
    expect(await saveEntry(db, owner, r.id, { ...base, start: at("2026-10-26T14:00"), end: at("2026-10-26T16:30") }, now)).toEqual({ ok: true, id: r.id });
    expect(await deleteEntry(db, omar, r.id)).toMatchObject({ ok: false });
  });

  it("hours are summed per day, split at midnight, and a running clock counts up to now", async () => {
    const now = at("2026-10-28T10:00");
    await saveEntry(db, owner, null, { userId: omar.id, start: at("2026-10-26T22:00"), end: at("2026-10-27T02:00") }, now);
    await clockIn(db, omar.id, null, at("2026-10-28T08:30"));
    const w = await workedByDay(db, "2026-10-26", 7, now);
    expect(Math.round(w.get(mona.id)!.get("2026-10-26")!)).toBe(210 + 150);
    expect(w.get(omar.id)!.get("2026-10-26")).toBe(120);
    expect(w.get(omar.id)!.get("2026-10-27")).toBe(120);
    expect(w.get(omar.id)!.get("2026-10-28")).toBe(90);
    expect(hours(90)).toBe("1h 30m");
    expect(mondayOf("2026-10-29")).toBe("2026-10-26");
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
  });

  it("events: own calendar only (owners for anyone), valid times, cancelled ones disappear", async () => {
    const meet = { userId: mona.id, title: "Clinic visit", kind: "meeting", start: at("2026-10-28T11:00"), end: at("2026-10-28T12:00"), allDay: false };
    expect(await saveEvent(db, omar, null, meet)).toMatchObject({ ok: false });
    expect(await saveEvent(db, mona, null, { ...meet, end: meet.start })).toMatchObject({ ok: false });
    expect(await saveEvent(db, mona, null, { ...meet, kind: "party" })).toMatchObject({ ok: false });
    expect(await saveEvent(db, mona, null, { ...meet, title: " " })).toMatchObject({ ok: false });
    const r = await saveEvent(db, mona, null, meet);
    expect(r.ok).toBe(true);
    const off = allDayRange("2026-10-29", "2026-10-30");
    const leave = await saveEvent(db, owner, null, { userId: omar.id, title: "Annual leave", kind: "leave", ...off, allDay: true });
    expect(leave.ok).toBe(true);
    const week = await listEvents(db, at("2026-10-26T00:00"), at("2026-11-02T00:00"));
    expect(week.map((e) => [e.person, e.title])).toEqual([
      ["Mona", "Clinic visit"],
      ["Omar", "Annual leave"],
    ]);
    if (!r.ok) return;
    expect(await cancelEvent(db, omar, r.id)).toMatchObject({ ok: false });
    expect(await cancelEvent(db, mona, r.id)).toEqual({ ok: true });
    expect((await listEvents(db, at("2026-10-26T00:00"), at("2026-11-02T00:00"))).map((e) => e.title)).toEqual(["Annual leave"]);
  });

  it("presence: working, in a meeting, away, or off", async () => {
    await saveEvent(db, mona, null, { userId: mona.id, title: "Team meeting", kind: "meeting", start: at("2026-10-28T09:30"), end: at("2026-10-28T10:30"), allDay: false });
    await clockIn(db, mona.id, null, at("2026-10-28T09:00"));
    const now = at("2026-10-28T10:00");
    let p = await presence(db, now);
    expect(p.find((x) => x.id === mona.id)).toMatchObject({ state: "busy", current: { title: "Team meeting" } });
    expect(p.find((x) => x.id === omar.id)).toMatchObject({ state: "working", since: at("2026-10-28T08:30") });
    expect(p.find((x) => x.id === owner.id)).toMatchObject({ state: "off" });
    p = await presence(db, at("2026-10-29T10:00"));
    expect(p.find((x) => x.id === omar.id)).toMatchObject({ state: "away", current: { title: "Annual leave" } });
  });
});
