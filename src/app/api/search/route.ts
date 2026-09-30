import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { searchLeads } from "@/lib/search";

export const dynamic = "force-dynamic";

// Command palette lead search. Any signed-in role may read leads; nothing is written.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  if (!can(user.role, "lead:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const hits = await searchLeads(db, q, 8);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
