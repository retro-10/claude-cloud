import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { DecisionForm } from "@/components/team/DecisionForm";
import { DecisionList } from "@/components/team/DecisionList";
import { Card, Icon, PageHeader } from "@/components/ui";
import { getMeeting, listDecisions } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { saveMeetingAction } from "../../actions";

export const metadata = { title: "Meeting · Team" };

export default async function MeetingPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const m = await getMeeting(db, Number(id));
  if (!m) notFound();
  const manage = can(user.role, "ops:manage");
  const [ds, people] = await Promise.all([listDecisions(db, { meetingId: m.id }), db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name))]);
  const back = `/team/meetings/${m.id}`;
  return (
    <>
      <Link href="/team/meetings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Meetings
      </Link>
      <PageHeader eyebrow={formatCairo(m.heldAt)} title={m.title} titleDir="auto" subtitle={m.attendees} />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-6">
          <Card title={`Decisions (${ds.length})`} icon="flag" bodyClass="p-0">
            <DecisionList rows={ds} me={user.id} manage={manage} back={back} showMeeting={false} />
          </Card>
          {manage && (
            <Card title="Log a decision" icon="plus">
              <DecisionForm people={people} meetingId={m.id} back={back} />
            </Card>
          )}
        </div>
        <Card title={manage ? "Agenda and notes" : "Notes"} icon="note">
          {manage ? (
            <form action={saveMeetingAction} className="grid gap-3">
              <input type="hidden" name="id" value={m.id} />
              <label className="field">
                Title
                <input name="title" required maxLength={200} defaultValue={m.title} dir="auto" className="input input-sm" />
              </label>
              <label className="field">
                When
                <input name="heldAt" type="datetime-local" required defaultValue={toCairoLocalInput(m.heldAt)} className="input input-sm" />
              </label>
              <label className="field">
                Who was there
                <input name="attendees" maxLength={500} defaultValue={m.attendees ?? ""} dir="auto" className="input input-sm" />
              </label>
              <label className="field">
                Agenda
                <textarea name="agenda" rows={4} maxLength={8000} defaultValue={m.agenda ?? ""} dir="auto" className="input" />
              </label>
              <label className="field">
                Notes
                <textarea name="notes" rows={10} maxLength={20000} defaultValue={m.notes ?? ""} dir="auto" className="input" />
              </label>
              <button className="btn btn-primary btn-sm justify-self-start">Save</button>
            </form>
          ) : (
            <div className="grid gap-3 text-sm">
              {m.agenda && <p className="whitespace-pre-wrap" dir="auto">{m.agenda}</p>}
              {m.notes ? <p className="whitespace-pre-wrap" dir="auto">{m.notes}</p> : <p className="text-muted">No notes.</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
