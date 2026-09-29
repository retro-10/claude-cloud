import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate } from "@/lib/auth";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import { CADENCES, STAGES } from "@/db/seed-data";

// Needs a scratch Postgres database. Set TEST_DATABASE_URL to run; otherwise skipped.
// WARNING: the schema is dropped and recreated. Never point this at real data.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("auth + seed against an empty database", () => {
  const client = postgres(url ?? "postgres://x", { max: 2 });
  const db = drizzle(client, { schema: s });

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url); // migrations apply cleanly on an empty DB
    await seedReference(url, "correct-horse-battery");
    await seedReference(url, "correct-horse-battery"); // idempotent
  });
  afterAll(() => client.end());

  it("seeds the nine stages, cadences and three users exactly once", async () => {
    const stages = await db.select().from(s.stages);
    expect(stages.map((x) => x.key).sort()).toEqual(STAGES.map((x) => x.key).sort());
    expect(await db.select().from(s.cadenceTemplates)).toHaveLength(CADENCES.length);
    expect(await db.select().from(s.users)).toHaveLength(3);
  });

  it("accepts the right password", async () => {
    const u = await authenticate(db, "retro@orladent.local", "correct-horse-battery");
    expect(u?.role).toBe("owner");
  });

  it("is case-insensitive on email", async () => {
    expect(await authenticate(db, "  RETRO@orladent.local ", "correct-horse-battery")).not.toBeNull();
  });

  it("rejects a wrong password and an unknown email", async () => {
    expect(await authenticate(db, "retro@orladent.local", "nope")).toBeNull();
    expect(await authenticate(db, "ghost@orladent.local", "correct-horse-battery")).toBeNull();
  });

  it("rejects an inactive user even with the right password", async () => {
    await db.insert(s.users).values({
      name: "Gone",
      email: "gone@orladent.local",
      passwordHash: await bcrypt.hash("pw", 4),
      role: "sales",
      active: false,
    });
    expect(await authenticate(db, "gone@orladent.local", "pw")).toBeNull();
  });

  it("stores phone numbers uniquely but allows many leads without a phone", async () => {
    await db.insert(s.leads).values([{ fullName: "A" }, { fullName: "B" }]);
    await db.insert(s.leads).values({ fullName: "C", phoneWhatsapp: "+201001234567" });
    await expect(
      db.insert(s.leads).values({ fullName: "D", phoneWhatsapp: "+201001234567" }),
    ).rejects.toThrow();
  });

  it("stores Arabic text intact", async () => {
    const [row] = await db.insert(s.leads).values({ fullName: "د. محمد علي" }).returning();
    const [back] = await db.select().from(s.leads).where(sql`${s.leads.id} = ${row.id}`);
    expect(back.fullName).toBe("د. محمد علي");
  });
});
