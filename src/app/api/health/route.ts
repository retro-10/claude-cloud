import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// For uptime monitors and the container healthcheck. No auth, no data: only "up" and "database reachable".
// ?parallel=1 runs several queries at once, the way a page does, to check the connection pool against the pooler.
export async function GET(req: NextRequest) {
  const parallel = req.nextUrl.searchParams.get("parallel") === "1";
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
