import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function runMigrations(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client.end();
  }
}

// Run directly: `tsx src/db/migrate.ts`
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => console.log("migrations applied"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
