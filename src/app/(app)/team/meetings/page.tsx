import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listMeetings } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { saveMeetingAction } from "../actions";

export const metadata = { title: "Meetings · Team" };

export default async function MeetingsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const manage = can(user.role, "ops:manage");
  const rows = await listMeetings(db);
  return (
    <>
      <PageHeader eyebrow="Team & operations" title="Meetings" subtitle="Agenda, notes and the decisions taken, each with an owner and a date." />
      <TeamTabs current="/team/meetings" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title={`Meetings (${rows.length})`} icon="calendar" bodyClass="p-0">
          {!rows.length ? (
            <EmptyState icon="calendar" title="No meetings logged yet." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="w-32 shrink-0 text-xs text-muted">{formatCairo(m.heldAt, false)}</div>
                  <Link href={`/team/meetings/${m.id}`} className="link min-w-0 flex-1 font-medium" dir="auto">
                    {m.title}
                  </Link>
                  <span className="text-xs text-muted">
                    {m.total} decision{m.total === 1 ? "" : "s"}
                    {m.open ? `, ${m.open} open` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manage && (
          <Card title="Log a meeting" icon="plus">
            <form action={saveMeetingAction} className="grid gap-3">
              <label className="field">
                Title
                <input name="title" required maxLength={200} dir="auto" className="input input-sm" placeholder="Owners' weekly meeting" />
              </label>
              <label className="field">
                When (Cairo time)
                <input name="heldAt" type="datetime-local" required defaultValue={toCairoLocalInput(new Date())} className="input input-sm" />
              </label>
              <label className="field">
                Who was there
                <input name="attendees" maxLength={500} dir="auto" className="input input-sm" />
              </label>
              <label className="field">
                Agenda
                <textarea name="agenda" rows={4} maxLength={8000} dir="auto" className="input" />
              </label>
              <button className="btn btn-primary btn-sm justify-self-start">Add meeting</button>
              <p className="text-xs text-muted">Add notes and decisions on the meeting&apos;s page.</p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
