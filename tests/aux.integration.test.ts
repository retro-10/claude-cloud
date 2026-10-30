import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { getSetting, saveSettings } from "@/lib/app-settings";
import { clockIn, clockOut, clockState, deleteEntry, endAux, listEntries, monthHours, presence, startAux, stopForgottenClocks, workedByDay } from "@/lib/calendar";
import { createUser } from "@/lib/settings";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const at = (local: string) => cairoLocalToDate(local)!;

d("away statuses on the clock (break, prayer, lunch)", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, mona: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [{ id: owner }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "retro@orladent.local"));
    const m = await createUser(db, { name: "Mona", email: "mona@aux.local", role: "sales", password: "long enough pw" }, null);
    if (!m.ok) throw new Error("user");
    mona = m.id;
  });
  afterAll(() => client.end());

  it("the three asked-for statuses exist by default, unpaid and without a limit; the list is validated", async () => {
    expect((await getSetting(db, "auxCodes")).map((c) => [c.key, c.label, c.paid, c.maxMinutes])).toEqual([
      ["break", "Break", false, null],
      ["prayer", "Prayer", false, null],
      ["lunch", "Lunch", false, null],
    ]);
    expect(await saveSettings(db, { auxCodes: [{ key: "a", label: "", paid: false, maxMinutes: null }] }, owner)).toMatchObject({ ok: false });
    expect(await saveSettings(db, { auxCodes: [{ key: "a", label: "A", paid: false, maxMinutes: 0 }] }, owner)).toMatchObject({ ok: false });
    expect(await saveSettings(db, { auxCodes: [{ key: "a", label: "A", paid: false, maxMinutes: null }, { key: "a", label: "B", paid: true, maxMinutes: null }] }, owner)).toMatchObject({ ok: false });
  });

  it("only while clocked in; switching ends the first status; Back ends it; unpaid time comes off the hours", async () => {
    expect(await startAux(db, mona, "break", at("2026-10-26T09:00"))).toEqual({ ok: false, error: "Clock in first" });
    await clockIn(db, mona, null, at("2026-10-26T09:00"));
    expect(await startAux(db, mona, "nap", at("2026-10-26T10:00"))).toMatchObject({ ok: false });
    expect(await startAux(db, mona, "break", at("2026-10-26T10:00"))).toMatchObject({ ok: true, label: "Break" });
    expect(await startAux(db, mona, "break", at("2026-10-26T10:05"))).toMatchObject({ ok: true }); // same status twice: no new row
    expect((await clockState(db, mona, at("2026-10-26T10:10"))).aux).toMatchObject({ code: "break", label: "Break" });
    expect(await startAux(db, mona, "prayer", at("2026-10-26T10:15"))).toMatchObject({ ok: true, label: "Prayer" });
    expect(await endAux(db, mona, at("2026-10-26T10:25"))).toEqual({ ok: true, minutes: 10, label: "Prayer" });
    expect(await endAux(db, mona, at("2026-10-26T10:26"))).toMatchObject({ ok: false });
    expect((await clockState(db, mona, at("2026-10-26T10:30"))).aux).toBeNull();

    // lunch still running when she clocks out: it ends with the clock
    await startAux(db, mona, "lunch", at("2026-10-26T13:00"));
    expect(await clockOut(db, mona, null, at("2026-10-26T13:30"))).toEqual({ ok: true, minutes: 270 - 15 - 10 - 30 });
    const open = await db.select().from(s.timeAux).where(eq(s.timeAux.userId, mona));
    expect(open.every((a) => a.endedAt)).toBe(true);
    expect(Math.round((await workedByDay(db, "2026-10-26", 1, at("2026-10-26T18:00"))).get(mona)!.get("2026-10-26")!)).toBe(215);
  });

  it("a paid status stays in the hours; the label and paid flag are kept from when it started", async () => {
    await saveSettings(db, { auxCodes: [{ key: "prayer", label: "Prayer", paid: true, maxMinutes: 15 }, { key: "lunch", label: "Lunch", paid: false, maxMinutes: null }] }, owner);
    await clockIn(db, mona, null, at("2026-10-27T09:00"));
    await startAux(db, mona, "prayer", at("2026-10-27T12:00"));
    expect(await clockOut(db, mona, null, at("2026-10-27T12:30"))).toEqual({ ok: true, minutes: 210 });
    // renaming the status later does not rewrite what was recorded
    await saveSettings(db, { auxCodes: [{ key: "prayer", label: "Salah", paid: false, maxMinutes: 15 }] }, owner);
    const [row] = await db.select().from(s.timeAux).where(eq(s.timeAux.code, "prayer")).orderBy(s.timeAux.id);
    expect(row).toMatchObject({ label: "Prayer" });
    expect(Math.round((await workedByDay(db, "2026-10-27", 1, at("2026-10-27T18:00"))).get(mona)!.get("2026-10-27")!)).toBe(210);
  });

  it("everyone sees the status; past its limit it is marked over", async () => {
    await clockIn(db, mona, null, at("2026-10-28T09:00"));
    await startAux(db, mona, "prayer", at("2026-10-28T12:00"));
    let p = (await presence(db, at("2026-10-28T12:10"))).find((x) => x.id === mona)!;
    expect(p).toMatchObject({ state: "aux", aux: { label: "Salah", over: false } });
    p = (await presence(db, at("2026-10-28T12:20"))).find((x) => x.id === mona)!;
    expect(p.aux).toMatchObject({ over: true });
  });

  it("a forgotten clock stops at midnight and takes its away status with it", async () => {
    expect(await stopForgottenClocks(db, at("2026-10-29T09:00"))).toBe(1);
    const [a] = await db.select().from(s.timeAux).where(eq(s.timeAux.userId, mona)).orderBy(s.timeAux.id).limit(1).offset(4);
    expect(a.endedAt).toEqual(at("2026-10-29T00:00"));
    // 09:00 to midnight is 15h; Salah (unpaid since the rename) ran 12:00 to midnight: 3h worked
    expect(Math.round((await workedByDay(db, "2026-10-28", 1, at("2026-10-29T09:00"))).get(mona)!.get("2026-10-28")!)).toBe(180);
  });

  it("payroll: worked minutes, clocked minutes and minutes per status", async () => {
    const { summary, detail } = await monthHours(db, "2026-10", at("2026-11-01T00:00"));
    const t = summary.find((x) => x.email === "mona@aux.local")!;
    expect(Math.round(t.clockMinutes)).toBe(270 + 210 + 900);
    expect(Math.round(t.minutes)).toBe(215 + 210 + 180);
    expect(Object.fromEntries(Object.entries(t.away).map(([k, v]) => [k, Math.round(v)]))).toEqual({ Break: 15, Prayer: 40, Lunch: 30, Salah: 720 });
    expect(detail.filter((r) => r.email === "mona@aux.local")).toHaveLength(3);
  });

  it("deleting a stretch of hours deletes its away statuses", async () => {
    const [e] = await listEntries(db, mona, at("2026-10-26T00:00"), at("2026-10-27T00:00"));
    expect(await deleteEntry(db, { id: owner, role: "owner" }, e.id)).toEqual({ ok: true });
    expect(await db.select().from(s.timeAux).where(eq(s.timeAux.entryId, e.id))).toEqual([]);
  });
});
