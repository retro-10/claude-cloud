import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { addDaysYmd, cairoYmd } from "../lib/time";
import { insertDemo } from "./demo-data";
import * as s from "./schema";
import {
  BUILTIN_RULES,
  CADENCES,
  DEFAULT_CRITERIA,
  DEMO_USERS,
  LOST_REASONS,
  LOST_REASONS_1_1,
  OBJECTIONS,
  REMOVED_USERS,
  SOURCES,
  STAGES,
  TEMPLATES,
} from "./seed-data";

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
    await seedRelease11(db);

    // placeholder so the enrolment prompt works out of the box; rename or replace it in Batches (40 seats is the camp cap)
    const existing = await db.select({ id: s.cohorts.id }).from(s.cohorts).limit(1);
    if (!existing.length) await db.insert(s.cohorts).values({ name: "Demo cohort", seatCap: 40 });

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .insert(s.users)
      .values(DEMO_USERS.map((u) => ({ ...u, passwordHash })))
      .onConflictDoNothing();

    for (const email of REMOVED_USERS) {
      try {
        await db.delete(s.users).where(eq(s.users.email, email));
      } catch {
        // foreign keys: the user has history, so keep the row but block login
        await db.update(s.users).set({ active: false }).where(eq(s.users.email, email));
      }
    }

    // new leads belong to Retro unless a route says otherwise (owners' answer to QUESTIONS.md 27). Only set
    // when nobody has saved a default owner yet, so a choice made in Settings > Thresholds & routing stays.
    const [retro] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "retro@orladent.local"));
    if (retro) await db.insert(s.appSettings).values({ key: "defaultOwnerId", value: retro.id }).onConflictDoNothing();
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedReference()
    .then(async () => {
      if (process.env.SEED_DEMO === "true") console.log((await seedDemoIfEmpty()) ? "demo data added" : "demo data skipped (database already has leads)");
    })
    .then(() => console.log("seed complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

// Demo leads for a fresh clone (SEED_DEMO=true): only into an empty database, never on top of real data.
// Dates are shifted so the data always ends about "now": it starts on the Monday five weeks ago.
export async function seedDemoIfEmpty(url = process.env.DATABASE_URL, now = new Date()) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema: s });
  try {
    const existing = await db.select({ id: s.leads.id }).from(s.leads).limit(1);
    if (existing.length) return false;
    const today = cairoYmd(now);
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(`${addDaysYmd(today, -weekday - 35)}T12:00:00Z`);
    await insertDemo(db as never, start, { now, withFollowUps: true });
    return true;
  } finally {
    await client.end();
  }
}

/**
 * Release 1.1 defaults. Idempotent, and never overwrites what the owner changed: criteria, rules and
 * templates are inserted once; a marker row in app_settings records that the one-time parts ran.
 */
async function seedRelease11(db: ReturnType<typeof drizzle>) {
  await db.insert(s.lostReasons).values(LOST_REASONS_1_1).onConflictDoNothing();

  // built-in rules by key: a rule added in a later release reaches existing databases; edits are never overwritten
  await db
    .insert(s.workflowRules)
    .values(BUILTIN_RULES.map((r) => ({ ...r, builtin: true, enabled: true })))
    .onConflictDoNothing();

  const [marker] = await db.select().from(s.appSettings).where(eq(s.appSettings.key, "seeded_1_1"));
  if (marker) return;

  const stageKeys = new Set((await db.select({ key: s.stages.key }).from(s.stages)).map((r) => r.key));
  const criteria = Object.entries(DEFAULT_CRITERIA).flatMap(([stageKey, checks]) =>
    stageKeys.has(stageKey) ? checks.map((checkKey) => ({ stageKey, checkKey, required: true })) : [],
  );
  if (criteria.length) await db.insert(s.stageExitCriteria).values(criteria).onConflictDoNothing();
  const anyTemplate = await db.select({ id: s.messageTemplates.id }).from(s.messageTemplates).limit(1);
  if (!anyTemplate.length) await db.insert(s.messageTemplates).values(TEMPLATES);
  await db.insert(s.appSettings).values({ key: "seeded_1_1", value: true }).onConflictDoNothing();
}
