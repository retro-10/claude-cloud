import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  addDecision,
  closeDecision,
  listDecisions,
  listMeetings,
  listResponsibilities,
  listRuns,
  listSops,
  parseSteps,
  saveMeeting,
  saveResponsibility,
  saveSop,
  startRun,
  tickStep,
} from "@/lib/operations";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("playbook steps (pure)", () => {
  it("one per line, numbering and bullets dropped", () => {
    expect(parseSteps("1. Send the reminder\n2) Check payments\n\n- Issue certificates")).toEqual(["Send the reminder", "Check payments", "Issue certificates"]);
    expect(parseSteps("  \n")).toMatch(/one per line/);
    expect(parseSteps(Array.from({ length: 41 }, (_, i) => `s${i}`).join("\n"))).toMatch(/40/);
  });
});

d("team and operations", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let a: number, b: number, sopId: number, leadId: number, cohortId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [a, b] = (await db.select().from(s.users)).map((u) => u.id);
    [{ id: leadId }] = await db.insert(s.leads).values({ fullName: "Mona Student" }).returning();
    [{ id: cohortId }] = await db.insert(s.cohorts).values({ name: "Batch 9", seatCap: 40 }).returning();
  });
  afterAll(() => client.end());

  it("responsibilities: a job nobody active does is a gap", async () => {
    expect(await saveResponsibility(db, null, { area: " " }, a)).toMatchObject({ ok: false });
    expect(await saveResponsibility(db, null, { area: "x", cadence: "hourly" }, a)).toMatchObject({ ok: false });
    await saveResponsibility(db, null, { area: "Reply to new leads", cadence: "daily", responsibleId: a, accountableId: b }, a);
    await saveResponsibility(db, null, { area: "Post on Instagram", cadence: "daily", responsibleId: b }, a);
    await saveResponsibility(db, null, { area: "QC every case", cadence: "as it happens" }, a);
    let rows = await listResponsibilities(db);
    expect(rows.map((r) => [r.area, r.gap])).toEqual([["Reply to new leads", false], ["Post on Instagram", false], ["QC every case", true]]);
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, b));
    rows = await listResponsibilities(db);
    expect(rows.find((r) => r.area === "Post on Instagram")!.gap).toBe(true);
    await db.update(s.users).set({ active: true }).where(eq(s.users.id, b));
  });

  it("a playbook run as a checklist keeps its steps; ticking all completes it, unticking reopens it", async () => {
    const r = await saveSop(db, null, { title: "Onboard a student", area: "Programme", steps: ["Add to the WhatsApp group", "Send the welcome pack", "Book the first 1:1"] }, a);
    if (!r.ok) throw new Error(r.error);
    sopId = r.id;
    const run = await startRun(db, sopId, { leadId, assigneeId: b, cohortId }, a);
    if (!run.ok) throw new Error(run.error);
    // editing the playbook later does not change a checklist already started
    await saveSop(db, sopId, { title: "Onboard a student", steps: ["Only one step now"] }, a);
    let [row] = await db.select().from(s.sopRuns).where(eq(s.sopRuns.id, run.id));
    expect(row.title).toBe("Onboard a student — Mona Student");
    expect(row.steps.map((x) => x.text)).toEqual(["Add to the WhatsApp group", "Send the welcome pack", "Book the first 1:1"]);
    expect(await tickStep(db, run.id, 5, true, b)).toMatchObject({ ok: false });
    expect(await tickStep(db, run.id, 0, true, b)).toEqual({ ok: true, complete: false });
    expect(await tickStep(db, run.id, 1, true, b)).toEqual({ ok: true, complete: false });
    expect(await tickStep(db, run.id, 2, true, b)).toEqual({ ok: true, complete: true });
    [row] = await db.select().from(s.sopRuns).where(eq(s.sopRuns.id, run.id));
    expect(row.completedAt).not.toBeNull();
    expect(row.steps[2].doneBy).toBe(b);
    expect(await tickStep(db, run.id, 2, false, b)).toEqual({ ok: true, complete: false });
    [row] = await db.select().from(s.sopRuns).where(eq(s.sopRuns.id, run.id));
    expect(row.completedAt).toBeNull();
    expect((await listRuns(db, { leadId })).map((x) => x.doneSteps)).toEqual([2]);
    expect((await listSops(db))[0]).toMatchObject({ open: 1, done: 0 });
  });

  it("meetings and decisions: open ones overdue after their date; closed by their owner or an owner of the business", async () => {
    const m = await saveMeeting(db, null, { title: "Owners' weekly", heldAt: cairoLocalToDate("2026-10-04T20:00")! }, a);
    if (!m.ok) throw new Error(m.error);
    const d1 = await addDecision(db, { meetingId: m.id, title: "Raise the Foundation price", ownerId: b, dueAt: cairoLocalToDate("2026-10-10T09:00")! }, a);
    const d2 = await addDecision(db, { meetingId: m.id, title: "Try TikTok ads", ownerId: a }, a);
    if (!d1.ok || !d2.ok) throw new Error("setup");
    const now = cairoLocalToDate("2026-10-12T09:00")!;
    let open = await listDecisions(db, { status: "open" }, now);
    expect(open.map((x) => [x.title, x.overdue])).toEqual([["Raise the Foundation price", true], ["Try TikTok ads", false]]);
    // not its owner, and not allowed to manage: refused
    expect(await closeDecision(db, d2.id, "done", null, { id: b, canManage: false })).toMatchObject({ ok: false });
    expect(await closeDecision(db, d1.id, "done", "Applies from Batch 9", { id: b, canManage: false })).toEqual({ ok: true });
    expect(await closeDecision(db, d2.id, "dropped", null, { id: b, canManage: true })).toEqual({ ok: true });
    open = await listDecisions(db, { status: "open" }, now);
    expect(open).toHaveLength(0);
    const closed = await listDecisions(db, { status: "closed" }, now);
    expect(closed.find((x) => x.id === d1.id)).toMatchObject({ status: "done", outcome: "Applies from Batch 9", closedBy: b });
    expect((await listMeetings(db))[0]).toMatchObject({ total: 2, open: 0 });
    expect(await closeDecision(db, d1.id, "open", null, { id: a, canManage: true })).toEqual({ ok: true });
    expect((await listDecisions(db, { status: "open" }, now)).map((x) => x.id)).toEqual([d1.id]);
  });
});
