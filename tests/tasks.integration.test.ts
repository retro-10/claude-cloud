import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createCohort } from "@/lib/cohorts";
import { createLead } from "@/lib/leads";
import { mergeLeads, undoMerge } from "@/lib/merge";
import { createTask, listTasks, setTaskState, taskCounts, updateTask } from "@/lib/tasks";
import { followUpDue } from "@/lib/time";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("team tasks", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const now = new Date("2026-10-07T10:00:00Z"); // a Wednesday, 13:00 in Cairo
  let retro: number, badr: number, leadId: number, cohortId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    const u = await db.select().from(s.users);
    retro = u.find((x) => x.email === "retro@orladent.local")!.id;
    badr = u.find((x) => x.email === "badr@orladent.local")!.id;
    const l = await createLead(db, { fullName: "Task Lead", phone: "01012340000" }, retro);
    if (!l.ok) throw new Error("setup");
    leadId = l.lead.id;
    cohortId = (await createCohort(db, { name: "Batch 7", seatCap: 40 }, retro)).id;
  });
  afterAll(() => client.end());

  it("adds a task (to me by default), refuses bad input, and links it to a lead or a batch", async () => {
    expect(await createTask(db, { title: "   " }, retro)).toEqual({ ok: false, error: "Give the task a title" });
    expect(await createTask(db, { title: "x", leadId: 999999 }, retro)).toEqual({ ok: false, error: "That lead no longer exists" });
    expect(await createTask(db, { title: "x", cohortId: 999999 }, retro)).toEqual({ ok: false, error: "That batch no longer exists" });

    const a = await createTask(db, { title: "Send the offer PDF", leadId, dueAt: followUpDue("2026-10-06"), priority: "high" }, retro);
    const b = await createTask(db, { title: "Book the studio", cohortId, assigneeId: badr, dueAt: followUpDue("2026-10-07") }, retro);
    const c = await createTask(db, { title: "Draft the reel", assigneeId: null }, retro);
    expect(a.ok && b.ok && c.ok).toBe(true);

    const mine = await listTasks(db, { assigneeId: retro }, now);
    expect(mine).toMatchObject([{ title: "Send the offer PDF", leadName: "Task Lead", overdue: true, assignee: "Retro" }]);
    expect(await listTasks(db, { cohortId }, now)).toMatchObject([{ title: "Book the studio", cohortName: "Batch 7", assignee: "Badr", overdue: false }]);
    expect((await listTasks(db, { assigneeId: "none" }, now)).map((t) => t.title)).toEqual(["Draft the reel"]);
    // everyone's open tasks: dated first (earliest first), undated last
    expect((await listTasks(db, {}, now)).map((t) => t.title)).toEqual(["Send the offer PDF", "Book the studio", "Draft the reel"]);
    expect((await listTasks(db, { due: "overdue" }, now)).map((t) => t.title)).toEqual(["Send the offer PDF"]);
    expect((await listTasks(db, { due: "today" }, now)).map((t) => t.title)).toEqual(["Send the offer PDF", "Book the studio"]);
    expect(await taskCounts(db, retro, now)).toEqual({ mine: 1, mineOverdue: 1, overdue: 1, unassigned: 1 });
  });

  it("done, reopen and cancel; finished tasks leave the open list and show under done", async () => {
    const [t] = await listTasks(db, { assigneeId: retro }, now);
    expect(await setTaskState(db, t.id, "done", retro)).toBe(true);
    expect(await setTaskState(db, t.id, "done", retro)).toBe(false); // already done
    expect(await listTasks(db, { assigneeId: retro }, now)).toHaveLength(0);
    expect(await listTasks(db, { status: "done" }, now)).toMatchObject([{ id: t.id, overdue: false }]);
    expect(await setTaskState(db, t.id, "reopen", retro)).toBe(true);
    expect(await setTaskState(db, t.id, "cancel", retro)).toBe(true);
    expect(await taskCounts(db, retro, now)).toMatchObject({ mine: 0, overdue: 0 });
    const [row] = await db.select().from(s.tasks).where(eq(s.tasks.id, t.id));
    expect(row.cancelledAt).not.toBeNull();
  });

  it("edits a task, and only to an active person", async () => {
    const [t] = await listTasks(db, { assigneeId: "none" }, now);
    expect(await updateTask(db, t.id, { title: "Draft the reel script", assigneeId: badr, priority: "low" }, retro)).toEqual({ ok: true });
    await db.update(s.users).set({ active: false }).where(eq(s.users.email, "mo@orladent.local"));
    const [mo] = await db.select().from(s.users).where(eq(s.users.email, "mo@orladent.local"));
    expect(await updateTask(db, t.id, { assigneeId: mo.id }, retro)).toEqual({ ok: false, error: "Pick an active team member" });
    expect((await listTasks(db, { assigneeId: badr }, now)).map((x) => x.title)).toContain("Draft the reel script");
  });

  it("a lead's tasks move with it in a merge, and back on undo", async () => {
    const other = await createLead(db, { fullName: "Task Lead Twin", phone: "01012340001" }, retro);
    if (!other.ok) throw new Error("setup");
    const t = await createTask(db, { title: "Call the twin", leadId: other.lead.id }, retro);
    if (!t.ok) throw new Error("setup");
    const m = await mergeLeads(db, { survivorId: leadId, loserId: other.lead.id, pick: {} }, retro);
    if (!m.ok) throw new Error(m.error);
    expect((await listTasks(db, { leadId }, now)).map((x) => x.title)).toContain("Call the twin");
    expect((await undoMerge(db, m.mergeId, retro)).ok).toBe(true);
    expect((await listTasks(db, { leadId: other.lead.id }, now)).map((x) => x.title)).toEqual(["Call the twin"]);
  });
});
