import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

export const dynamic = "force-dynamic";

// For uptime monitors and the container healthcheck. No auth, no data: only "up" and "database reachable".
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "database unavailable" }, { status: 503 });
  }
}
