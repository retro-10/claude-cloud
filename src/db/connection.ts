import postgres from "postgres";

// One place that turns DATABASE_URL into postgres.js options, for the app, the migrator and the seed. The same code
// runs against the Docker database and a hosted one (Supabase):
// - Supabase only accepts TLS, so its hosts get ssl "require" (an explicit ?sslmode= in the URL still wins);
// - Supabase's transaction pooler (port 6543): prepared statements were off there by default. postgres.js then sends a
//   query with parameters in two round trips (describe, wait, then execute), and the pooler can leave the first one
//   unanswered: the page hangs until the function timeout (seen on Vercel). DATABASE_PREPARE=true keeps them on, so
//   every query goes in one round trip; each connection also sends one query at a time;
// - DATABASE_POOL_MAX caps the pool, to stay under a hosted plan's connection limit. Keep it above 1: on Vercel a pool
//   of one connection left signed-in pages hanging until the function timeout.
export function connectionOptions(url: string, max = Number(process.env.DATABASE_POOL_MAX) || 10): postgres.Options<Record<string, never>> {
  let host = "";
  let port = "";
  let sslmode: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port;
    sslmode = u.searchParams.get("sslmode");
  } catch {
    // postgres.js reports a malformed URL itself
  }
  const hosted = /(^|\.)(supabase\.co|supabase\.com)$/.test(host);
  return {
    max,
    onnotice: () => {},
    // on Vercel a function instance may be frozen between requests: close idle connections so a paused copy of the
    // app does not hold its pooler connections open
    ...(process.env.VERCEL ? { idle_timeout: 20 } : {}),
    ...(hosted && !sslmode ? { ssl: "require" as const } : {}),
    ...((port === "6543" && process.env.DATABASE_PREPARE !== "true") || process.env.DATABASE_PREPARE === "false" ? { prepare: false } : {}),
    ...(port === "6543" ? ({ max_pipeline: 1 } as postgres.Options<Record<string, never>>) : {}),
  };
}

export const connect = (url: string, max?: number) => postgres(url, connectionOptions(url, max));
