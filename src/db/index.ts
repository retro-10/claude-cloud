import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

export function createClient(url = process.env.DATABASE_URL) {
  // `next build` imports route modules to collect page data but never queries; the postgres
  // client connects lazily, so a placeholder is safe there. At runtime a missing URL is fatal.
  if (!url && process.env.NEXT_PHASE === "phase-production-build") url = "postgres://build:build@localhost:5432/build";
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, { max: 10 });
}

// Reuse one connection pool across hot reloads in dev.
const client = globalForDb.pgClient ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
