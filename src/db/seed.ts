import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "./schema";
import { CADENCES, DEMO_USERS, LOST_REASONS, OBJECTIONS, SOURCES, STAGES } from "./seed-data";

// Idempotent: safe to run on every container start. Existing rows are left untouched.
export async function seedReference(url = process.env.DATABASE_URL, password = process.env.SEED_PASSWORD) {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!password) throw new Error("SEED_PASSWORD is not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    await db.insert(s.stages).values([...STAGES]).onConflictDoNothing();
    await db.insert(s.sources).values(SOURCES.map((label) => ({ label }))).onConflictDoNothing();
    await db.insert(s.objections).values(OBJECTIONS.map((label) => ({ label }))).onConflictDoNothing();
    await db.insert(s.lostReasons).values(LOST_REASONS.map((label) => ({ label }))).onConflictDoNothing();
    await db.insert(s.cadenceTemplates).values(CADENCES).onConflictDoNothing();

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .insert(s.users)
      .values(DEMO_USERS.map((u) => ({ ...u, passwordHash })))
      .onConflictDoNothing();
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedReference()
    .then(() => console.log("seed complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
