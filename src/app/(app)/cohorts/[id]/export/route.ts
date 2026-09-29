import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { getCohort } from "@/lib/cohorts";
import { toCsv } from "@/lib/csv";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Revenue data: owner and finance only. Read-only GET, audited.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "revenue:export")) return new NextResponse("Forbidden", { status: 403 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new NextResponse("Not found", { status: 404 });
  const data = await getCohort(db, id);
  if (!data) return new NextResponse("Not found", { status: 404 });

  const rows = data.students.map((s) => [
    s.fullName, s.phone, s.email, s.tier, s.amountEgp, s.paidAt?.toISOString() ?? "", s.paymentRef, s.gateway,
  ]);
  const csv = toCsv([["name", "phone", "email", "tier", "amount_egp", "paid_at", "payment_ref", "gateway"], ...rows]);
  await audit(db, { userId: user.id, entity: "cohort", entityId: id, action: "export", diff: { count: rows.length } });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cohort-${id}-enrolments.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
