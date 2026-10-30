import postgres from "postgres";

// One place that turns DATABASE_URL into postgres.js options, for the app, the migrator and the seed. The same code
// runs against the Docker database and a hosted one (Supabase):
// - Supabase only accepts TLS, so its hosts get ssl "require" (an explicit ?sslmode= in the URL still wins);
// - Supabase's transaction pooler (port 6543) cannot keep prepared statements between queries, so they are off there;
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
    ...(port === "6543" || process.env.DATABASE_PREPARE === "false" ? { prepare: false } : {}),
  };
}

/**
 * SUPABASE_POOL_MODE=session moves a Supabase transaction-pooler URL (port 6543) to the session pooler on the same host
 * (port 5432, same credentials). The transaction pooler stalls queries that postgres.js pipelines on a busy connection,
 * which a page with nested parallel queries does; the session pooler is a real session and handles them.
 */
export function sessionPoolerUrl(url: string) {
  if (process.env.SUPABASE_POOL_MODE !== "session") return url;
  try {
    const u = new URL(url);
    if (u.port === "6543" && /\.pooler\.supabase\.com$/.test(u.hostname)) {
      u.port = "5432";
      return u.toString();
    }
  } catch {
    // postgres.js reports a malformed URL itself
  }
  return url;
}

export const connect = (url: string, max?: number) => {
  const target = sessionPoolerUrl(url);
  return postgres(target, connectionOptions(target, max));
};
