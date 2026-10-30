import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { searchEverything } from "@/lib/search";

export const dynamic = "force-dynamic";

// Command palette search across leads, tasks, docs, batches, campaigns, content, chat channels and approvals. Each
// kind is searched only for people allowed to read it; nothing is written.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const hits = await searchEverything(db, {
    userId: user.id,
    leads: can(user.role, "lead:read"),
    hq: can(user.role, "hq:read"),
    growth: can(user.role, "growth:read"),
    chat: can(user.role, "chat:write"),
    approvalsAll: can(user.role, "settings:write"),
    approvalsMoney: can(user.role, "finance:read"),
    comms: can(user.role, "comms:read"),
    brand: can(user.role, "brand:read"),
  }, q);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
