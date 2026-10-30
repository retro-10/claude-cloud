import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { submitRequest } from "@/lib/approvals";
import { createChannel } from "@/lib/chat";
import { saveDoc } from "@/lib/hq";
import { createTask } from "@/lib/tasks";
import { searchEverything, type SearchScope } from "@/lib/search";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("command palette search across records", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, mo: number;
  const scope = (over: Partial<SearchScope>): SearchScope => ({ userId: owner, leads: true, hq: true, growth: true, chat: true, approvalsAll: true, approvalsMoney: true, ...over });

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [{ id: owner }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "retro@orladent.local"));
    [{ id: mo }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "mo@orladent.local"));
    await createTask(db, { title: "Book the masterclass venue" }, owner);
    await saveDoc(db, null, { title: "Refund policy", body: "Students can ask for a refund within 7 days." }, owner);
    await createChannel(db, owner, { name: "launch-plan", topic: "Saturday batch" });
    await db.insert(s.campaigns).values({ label: "Ramadan masterclass" });
    const sayed = (await db.select().from(s.users).where(eq(s.users.email, "sayed@orladent.local")))[0];
    await submitRequest(db, { id: sayed.id, name: sayed.name }, { type: "leave", title: "Eid leave", startsOn: "2026-12-01" });
  });
  afterAll(() => client.end());

  it("finds tasks, docs (by their text), campaigns and channels, and forgives a typo", async () => {
    const kinds = async (q: string) => (await searchEverything(db, scope({}), q)).map((h) => `${h.kind}:${h.label}`);
    expect(await kinds("masterclass")).toEqual(expect.arrayContaining(["Tasks:Book the masterclass venue", "Campaigns:Ramadan masterclass"]));
    expect(await kinds("masterclas")).toEqual(expect.arrayContaining(["Tasks:Book the masterclass venue"]));
    expect(await kinds("mastrclass")).toEqual(expect.arrayContaining(["Campaigns:Ramadan masterclass"])); // a missing letter
    expect(await kinds("refund within")).toContain("Docs:Refund policy");
    expect(await kinds("launch")).toContain("Chat:#launch-plan");
    expect(await searchEverything(db, scope({}), "x")).toEqual([]);
  });

  it("only searches what the person may read", async () => {
    const marketing = await searchEverything(db, scope({ leads: false, approvalsAll: false, approvalsMoney: false, userId: mo }), "masterclass");
    expect(marketing.map((h) => h.kind)).not.toContain("Leads");
    const designer = await searchEverything(db, scope({ leads: false, hq: false, growth: false, approvalsAll: false, approvalsMoney: false, userId: mo }), "masterclass");
    expect(designer).toEqual([]);
    // someone else's leave: owners see it, finance (not a money request) and others do not
    expect((await searchEverything(db, scope({}), "eid leave")).map((h) => h.kind)).toContain("Approvals");
    expect((await searchEverything(db, scope({ userId: mo, approvalsAll: false, approvalsMoney: true }), "eid leave")).map((h) => h.kind)).not.toContain("Approvals");
  });

  it("links each hit to its page", async () => {
    const [task] = await searchEverything(db, scope({ growth: false, chat: false }), "venue");
    expect(task.href).toMatch(/^\/tasks\/\d+$/);
  });
});
