import Link from "next/link";
import { db } from "@/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listEvents } from "@/lib/events";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Masterclasses · Growth" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

// Masterclasses and events: who registered, who was reminded, who came, and who went on to a consult.
export default async function EventsPage() {
  await requirePageCan("lead:read");
  const rows = await listEvents(db);
  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Masterclasses"
        subtitle="Registrations, reminders, attendance and follow-up for each masterclass or event. Create one as a campaign of type Masterclass with its date, and a lead form for sign-ups."
        actions={
          <Link href="/growth/campaigns" className="btn btn-secondary btn-sm">
            New masterclass (campaign)
          </Link>
        }
      />
      <Card bodyClass="p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState icon="calendar" title="No masterclasses yet.">
            Create a campaign of type Masterclass (or Event) to see it here.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Masterclass</th>
                <th scope="col" className="text-right">Registered</th>
                <th scope="col" className="text-right">Reminded</th>
                <th scope="col" className="text-right">Came</th>
                <th scope="col" className="text-right">Show-up</th>
                <th scope="col" className="text-right">Consult after</th>
                <th scope="col" className="text-right">Enrolled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/growth/events/${e.id}`} className="link font-medium" dir="auto">
                      {e.label}
                    </Link>
                    <div className="text-xs text-muted">{e.eventAt ? formatCairo(e.eventAt) : "no date set"}</div>
                  </td>
                  <td className="num text-right">{e.registered}</td>
                  <td className="num text-right">{e.reminded}</td>
                  <td className="num text-right">{e.attended}</td>
                  <td className="num text-right">{pct(e.attended, e.attended + e.noShow)}</td>
                  <td className="num text-right">{e.consultedAfter}</td>
                  <td className="num text-right">{e.enrolled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
