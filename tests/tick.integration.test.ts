import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { runTick } from "@/lib/tick";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("one background round (the cron tick)", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
  });
  afterAll(() => client.end());

  it("runs every step and reports each; the backup and Notion only when asked (and set up)", async () => {
    expect(await runTick(db, { backup: false, notion: true })).toEqual({ rules: "ok", clocks: "ok", files: "ok", emails: "ok", reminders: "ok" }); // no NOTION_TOKEN here
    expect(Object.keys(await runTick(db, { backup: true, notion: false }))).toContain("backup");
  });
});
