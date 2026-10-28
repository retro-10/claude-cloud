import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "./connection";

export async function runMigrations(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = connect(url, 1);
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    // Supabase publishes every table in the public schema through its Data API, readable with the project's
    // public "anon" key. Row level security with no policies closes that door: the app connects as the tables'
    // owner, which RLS does not apply to, so nothing changes for it. Run on every start so new tables are covered;
    // on a plain Postgres it is harmless.
    await client.unsafe(`
      do $$
      declare t record;
      begin
        for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
                   and pg_get_userbyid(c.relowner) = current_user
        loop
          execute format('alter table public.%I enable row level security', t.relname);
        end loop;
      end $$;`);
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
