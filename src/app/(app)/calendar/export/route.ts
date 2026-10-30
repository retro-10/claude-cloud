import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { monthHours } from "@/lib/calendar";
import { toCsv } from "@/lib/csv";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { TZ } from "@/lib/time";

export const dynamic = "force-dynamic";

const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const decimal = (minutes: number) => (Math.round((minutes / 60) * 100) / 100).toFixed(2);

// Hours for payroll, one month: a summary per person, or every stretch. Owners and finance only; audited.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "finance:read")) return new NextResponse("Forbidden", { status: 403 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new NextResponse("Pick a month (YYYY-MM)", { status: 400 });
  const kind = req.nextUrl.searchParams.get("kind") === "detail" ? "detail" : "summary";
  const { detail, summary } = await monthHours(db, month);
  // one column per away status that appears this month, in minutes
  const awayCols = [...new Set([...summary, ...detail].flatMap((r) => Object.keys(r.away)))].sort();
  const awayHead = awayCols.map((k) => `away_${k.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_minutes`);
  const awayVals = (r: { away: Record<string, number> }) => awayCols.map((k) => Math.round(r.away[k] ?? 0));

  const csv =
    kind === "summary"
      ? toCsv([
          ["person", "email", "role", "month", "hours", "minutes", "clocked_minutes", ...awayHead, "days_worked", "stretches", "stopped_at_midnight"],
          ...summary.map((t) => [t.person, t.email, t.role, month, decimal(t.minutes), Math.round(t.minutes), Math.round(t.clockMinutes), ...awayVals(t), t.days, t.stretches, t.autoStopped]),
        ])
      : toCsv([
          ["person", "email", "date", "start", "end", "hours", "minutes", "clocked_minutes", ...awayHead, "note", "stopped_at_midnight", "still_running"],
          ...detail.map((r) => [r.person, r.email, r.date, clock(r.start), clock(r.end), decimal(r.minutes), Math.round(r.minutes), Math.round(r.clockMinutes), ...awayVals(r), r.note ?? "", r.autoStopped ? "yes" : "", r.running ? "yes" : ""]),
        ]);
  await audit(db, { userId: user.id, entity: "time_entry", action: "export", diff: { month, kind, rows: kind === "summary" ? summary.length : detail.length } });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hours-${month}-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
