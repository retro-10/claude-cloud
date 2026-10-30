import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { listSpaces } from "@/lib/hq";
import { navCounts } from "@/lib/nav-counts";
import { getToday } from "@/lib/today";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// For uptime monitors and the container healthcheck. No auth, no data: only "up" and "database reachable".
// ?parallel=1 runs several queries at once, the way a page does, to check the connection pool against the pooler.
export async function GET(req: NextRequest) {
  const parallel = req.nextUrl.searchParams.get("parallel") === "1";
  // temporary diagnosis (DEBUG_TIMING=1): which page loaders finish, as names and times only; the database's session
  // list goes to the runtime log, never the response
  if (process.env.DEBUG_TIMING === "1" && req.nextUrl.searchParams.get("loaders") === "1") {
    const t0 = Date.now();
    const timed = (name: string, p: Promise<unknown>) =>
      Promise.race([p.then(() => `${name} ok`, (e: Error) => `${name} error ${e.message.slice(0, 120)}`), new Promise<string>((r) => setTimeout(() => r(`${name} TIMEOUT`), 12_000))]).then((x) => `${x} +${Date.now() - t0}ms`);
    const settings = await db
      .execute(sql`select current_user as role, current_setting('statement_timeout') as statement_timeout, current_setting('lock_timeout') as lock_timeout,
        (select rolconfig from pg_roles where rolname = current_user) as role_config,
        (select array_agg(coalesce(r.rolname, '*') || ' ' || array_to_string(s.setconfig, ',')) from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole) as db_role_settings`)
      .catch((e: Error) => e.message);
    console.log("[timing] settings", JSON.stringify(settings));
    const out = await Promise.all([timed("navCounts", navCounts(db)), timed("listSpaces", listSpaces(db)), timed("getToday", getToday(db))]);
    const activity = await Promise.race([
      db.execute(sql`select pid, state, wait_event_type, wait_event, now() - query_start as age, left(regexp_replace(query, '\s+', ' ', 'g'), 100) as q,
        pg_blocking_pids(pid) as blocked_by from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'`),
      new Promise((r) => setTimeout(() => r("activity TIMEOUT"), 8_000)),
    ]);
    console.log("[timing] loaders", JSON.stringify(out), JSON.stringify(activity));
    return NextResponse.json({ loaders: out });
  }
  const started = Date.now();
  try {
    // with parameters, as real queries have (they take the extended protocol), and nested batches, as a page does
    const batch = () => Promise.all(Array.from({ length: 4 }, (_, i) => db.execute(sql`select ${i}::int as n`)));
    const run = parallel ? Promise.all(Array.from({ length: 8 }, batch)) : db.execute(sql`select 1`);
    await Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000))]);
    return NextResponse.json({ status: "ok", ...(parallel ? { ms: Date.now() - started } : {}) });
  } catch {
    return NextResponse.json({ status: "database unavailable" }, { status: 503 });
  }
}
