import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  DEFAULT_STATUSES,
  archiveDoc,
  archiveList,
  bucketOf,
  checkStatuses,
  createStarterSpaces,
  getDoc,
  getSpace,
  listDocs,
  listSpaces,
  moveTask,
  saveDoc,
  saveList,
  saveSpace,
  spaceTasks,
  statusOf,
} from "@/lib/hq";
import { createTask, setTaskState } from "@/lib/tasks";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("HQ: spaces, lists, statuses, tasks and docs", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let me: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [{ id: me }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.role, "owner")).limit(1);
  });
  afterAll(() => client.end());

  it("statuses need an open and a done one, get stable unique keys and sort by group", () => {
    expect(checkStatuses([])).toMatchObject({ ok: false });
    expect(checkStatuses([{ label: "Done", group: "done" }])).toMatchObject({ ok: false, error: expect.stringContaining("open") });
    expect(checkStatuses([{ label: "Open", group: "todo" }])).toMatchObject({ ok: false, error: expect.stringContaining("Done") });
    expect(checkStatuses([{ label: "X", group: "nope" }])).toMatchObject({ ok: false });
    const r = checkStatuses([
      { label: "Shipped", group: "done", color: "ok" },
      { label: "Doing it", group: "active", color: "rainbow" },
      { label: "Doing it", group: "active" },
      { label: "  ", group: "todo" },
      { label: "Backlog", group: "todo" },
    ]);
    expect(r.ok && r.statuses.map((x) => [x.key, x.group, x.color])).toEqual([
      ["backlog", "todo", "slate"],
      ["doing_it", "active", "slate"],
      ["doing_it_2", "active", "slate"],
      ["shipped", "done", "ok"],
    ]);
  });

  it("the starter layout is created once, only on an empty HQ", async () => {
    expect(await createStarterSpaces(db, me)).toEqual({ ok: true, created: 5 });
    expect(await createStarterSpaces(db, me)).toMatchObject({ ok: false });
    const tree = await listSpaces(db);
    expect(tree.map((x) => x.name)).toEqual(["Sales", "Academy", "Studio", "Marketing", "Operations"]);
    expect(tree[0].lists.map((l) => l.name)).toEqual(["Sales projects", "Partnerships"]);
    expect(tree[0].statuses).toEqual(DEFAULT_STATUSES);
  });

  it("tasks in a list start in the first open status; moving to Done finishes them and back reopens", async () => {
    const [space] = await listSpaces(db);
    const list = space.lists[0].id;
    const a = await createTask(db, { title: "Draft the partner offer", listId: list }, me);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    let [t] = await spaceTasks(db, space);
    expect(t).toMatchObject({ title: "Draft the partner offer", status: "todo", assigneeId: me, listName: "Sales projects" });

    expect(await moveTask(db, a.id, { status: "nope" }, me)).toMatchObject({ ok: false });
    expect(await moveTask(db, a.id, { status: "done" }, me)).toEqual({ ok: true });
    expect(await spaceTasks(db, space)).toHaveLength(0); // closed tasks are hidden by default
    [t] = await spaceTasks(db, space, { closed: true });
    expect(t.status).toBe("done");
    expect(t.doneAt).not.toBeNull();

    expect(await moveTask(db, a.id, { status: "review" }, me)).toEqual({ ok: true });
    [t] = await spaceTasks(db, space);
    expect(t).toMatchObject({ status: "review", doneAt: null });

    // finishing it from the plain Tasks page keeps the HQ status in step
    await setTaskState(db, a.id, "done", me);
    [t] = await spaceTasks(db, space, { closed: true });
    expect(t.status).toBe("done");
    await setTaskState(db, a.id, "reopen", me);
    [t] = await spaceTasks(db, space);
    expect(t.status).toBe("todo");

    // a status picked at creation is checked against the space; a Done status creates it finished
    expect(await createTask(db, { title: "x", listId: list, status: "nope" }, me)).toMatchObject({ ok: false });
    const b = await createTask(db, { title: "Already sent", listId: list, status: "done" }, me);
    expect(b.ok).toBe(true);
    expect((await spaceTasks(db, space, { closed: true })).find((x) => x.title === "Already sent")?.doneAt).not.toBeNull();
  });

  it("subtasks live in their parent's list, one level deep, and roll up on the parent", async () => {
    const [space] = await listSpaces(db);
    const parent = await createTask(db, { title: "Launch the referral scheme", listId: space.lists[1].id }, me);
    if (!parent.ok) throw new Error(parent.error);
    const c1 = await createTask(db, { title: "Write the terms", parentId: parent.id }, me);
    const c2 = await createTask(db, { title: "Design the card", parentId: parent.id, listId: space.lists[0].id }, me);
    if (!c1.ok || !c2.ok) throw new Error("subtask");
    expect(await createTask(db, { title: "too deep", parentId: c1.id }, me)).toMatchObject({ ok: false });
    await moveTask(db, c1.id, { status: "done" }, me);
    const rows = await spaceTasks(db, space, { listId: space.lists[1].id });
    expect(rows.map((r) => r.title)).toEqual(["Launch the referral scheme"]); // subtasks are not top-level rows
    expect(rows[0]).toMatchObject({ subtasks: 2, subtasksDone: 1 });
    const all = await spaceTasks(db, space, { listId: space.lists[1].id, subtasks: true, closed: true });
    expect(all.map((r) => r.title).sort()).toEqual(["Design the card", "Launch the referral scheme", "Write the terms"]);
  });

  it("search matches titles and tags; filters narrow to a list and a person", async () => {
    const [space] = await listSpaces(db);
    await createTask(db, { title: "Price sheet", listId: space.lists[0].id, tags: ["Pricing", "pricing", " "], assigneeId: null }, me);
    expect((await spaceTasks(db, space, { q: "sheet" })).map((t) => t.title)).toEqual(["Price sheet"]);
    expect((await spaceTasks(db, space, { q: "pricing" })).map((t) => t.tags)).toEqual([["pricing"]]);
    expect((await spaceTasks(db, space, { q: "100%" }))).toEqual([]);
    expect((await spaceTasks(db, space, { assigneeId: me })).some((t) => t.title === "Price sheet")).toBe(false);
  });

  it("removing a status moves its tasks to another status of the same group", async () => {
    const space = (await listSpaces(db))[0];
    const r = await createTask(db, { title: "In review", listId: space.lists[0].id, status: "review" }, me);
    if (!r.ok) throw new Error(r.error);
    const keep = space.statuses.filter((x) => x.key !== "review");
    expect(await saveSpace(db, space.id, { name: space.name, statuses: keep }, me)).toEqual({ ok: true, id: space.id });
    const [t] = (await spaceTasks(db, (await getSpace(db, space.id))!)).filter((x) => x.id === r.id);
    expect(t.status).toBe("doing");
  });

  it("archived lists drop out of the space with their tasks", async () => {
    const space = (await listSpaces(db))[1];
    const l = await saveList(db, null, { spaceId: space.id, name: "Temp" }, me);
    if (!l.ok) throw new Error(l.error);
    await createTask(db, { title: "temp task", listId: l.id }, me);
    expect((await spaceTasks(db, space)).length).toBe(1);
    expect(await archiveList(db, l.id, me)).toEqual({ ok: true });
    expect(await spaceTasks(db, space)).toEqual([]);
    expect(await createTask(db, { title: "x", listId: l.id }, me)).toMatchObject({ ok: false });
  });

  it("statusOf falls back to a sensible status", () => {
    expect(statusOf(DEFAULT_STATUSES, { status: null, doneAt: null })).toBe("todo");
    expect(statusOf(DEFAULT_STATUSES, { status: "gone", doneAt: new Date() })).toBe("done");
    expect(statusOf(DEFAULT_STATUSES, { status: "done", doneAt: null })).toBe("todo");
  });

  it("my-work buckets follow the Cairo calendar", () => {
    const now = new Date("2026-10-20T10:00:00Z"); // 13:00 in Cairo
    expect(bucketOf(null, now)).toBe("unscheduled");
    expect(bucketOf(new Date("2026-10-19T07:00:00Z"), now)).toBe("overdue");
    expect(bucketOf(new Date("2026-10-20T20:00:00Z"), now)).toBe("today");
    expect(bucketOf(new Date("2026-10-27T07:00:00Z"), now)).toBe("next");
    expect(bucketOf(new Date("2026-10-29T07:00:00Z"), now)).toBe("later");
  });

  it("docs nest, refuse loops, search the body and archive with their sub-pages", async () => {
    const [space] = await listSpaces(db);
    const top = await saveDoc(db, null, { title: "Sales playbook", body: "How we handle a **masterclass** lead.", spaceId: space.id, wiki: true }, me);
    if (!top.ok) throw new Error(top.error);
    const child = await saveDoc(db, null, { title: "Objections", parentId: top.id }, me);
    if (!child.ok) throw new Error(child.error);
    expect(await saveDoc(db, top.id, { title: "Sales playbook", parentId: child.id }, me)).toMatchObject({ ok: false });
    expect(await saveDoc(db, top.id, { title: "Sales playbook", parentId: top.id }, me)).toMatchObject({ ok: false });
    expect(await saveDoc(db, null, { title: "  " }, me)).toMatchObject({ ok: false });
    expect((await getDoc(db, top.id))?.children.map((c) => c.title)).toEqual(["Objections"]);
    expect((await listDocs(db, { q: "masterclass" })).map((x) => x.title)).toEqual(["Sales playbook"]);
    expect((await listDocs(db, { spaceId: space.id }))[0]).toMatchObject({ title: "Sales playbook", wiki: true, spaceName: "Sales" });
    expect(await archiveDoc(db, top.id, me)).toEqual({ ok: true });
    expect(await getDoc(db, child.id)).toBeNull();
    expect(await listDocs(db)).toEqual([]);
  });
});
