import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { exportLeadsCsv } from "@/lib/export";
import type { LeadFilters } from "@/lib/lead-list";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Read-only GET, so no CSRF surface. Exports contain personal data: owners only, and audited.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "lead:export")) return new NextResponse("Forbidden", { status: 403 });

  const filters = Object.fromEntries(req.nextUrl.searchParams) as LeadFilters;
  const { csv, count } = await exportLeadsCsv(db, filters);
  await audit(db, { userId: user.id, entity: "lead", action: "export", diff: { count } });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
