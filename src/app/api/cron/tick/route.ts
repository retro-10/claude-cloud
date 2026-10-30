import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The background work on hosts that run code only for requests (Vercel). A scheduler calls this every 5 minutes:
//   Authorization: Bearer <CRON_SECRET>
// (Vercel's own cron sends exactly that header; Supabase pg_cron sends it with pg_net, see the README.)
// Off without CRON_SECRET; the token is compared in constant time before anything runs.
const digest = (s: string) => createHash("sha256").update(s).digest();

async function handle(req: NextRequest) {
  const token = process.env.CRON_SECRET?.trim();
  if (!token) return NextResponse.json({ ok: false, error: "not configured" }, { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(digest(given), digest(token))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // the backup needs pg_dump, which Vercel does not have: a GitHub Action takes it there (BACKUP_IN_APP=false)
  const steps = await runTick(db, { backup: process.env.BACKUP_IN_APP !== "false", notion: true });
  return NextResponse.json({ ok: true, steps });
}

export const GET = handle;
export const POST = handle;
