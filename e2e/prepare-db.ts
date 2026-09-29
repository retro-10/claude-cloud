import postgres from "postgres";
import { runMigrations } from "../src/db/migrate";
import { seedDemoIfEmpty, seedReference } from "../src/db/seed";

// Fresh scratch database for the end-to-end run: drop, create, migrate, seed (with demo data).
const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL is not set");
const name = url.slice(url.lastIndexOf("/") + 1).split("?")[0];
if (!/^crm_e2e\w*$/.test(name)) throw new Error(`refusing to reset "${name}": the end-to-end database must be called crm_e2e*`);

async function main() {
  const admin = postgres(`${url!.slice(0, url!.lastIndexOf("/"))}/postgres`, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  await runMigrations(url);
  await seedReference(url, process.env.SEED_PASSWORD);
  await seedDemoIfEmpty(url);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
