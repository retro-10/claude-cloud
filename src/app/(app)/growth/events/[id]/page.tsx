import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cadenceTemplates, campaigns, leadForms } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Registrants } from "@/components/growth/Registrants";
import { Card, Icon, PageHeader, Stat } from "@/components/ui";
import { listEvents, registrants } from "@/lib/events";
import { publicBaseUrl } from "@/lib/public-url";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { addRegistrantAction, followUpEventAction } from "../actions";

export const metadata = { title: "Masterclass · Growth" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function EventPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [[c], all, people, forms, cadences, base] = await Promise.all([
    db.select().from(campaigns).where(eq(campaigns.id, id)),
    listEvents(db),
    registrants(db, id),
    db.select().from(leadForms).where(eq(leadForms.campaignId, id)),
    db.select({ id: cadenceTemplates.id, name: cadenceTemplates.name }).from(cadenceTemplates).orderBy(asc(cadenceTemplates.name)),
    publicBaseUrl(),
  ]);
  const e = all.find((x) => x.id === id);
  if (!c || !e) notFound();
  const write = can(user.role, "growth:write");
  const when = c.eventAt ? formatCairo(c.eventAt) : "the date we sent you";
  const defaultMessage = `Hi {name}, a quick reminder: the OrlaDent Camp masterclass "${c.label}" is on ${when} (Cairo time). See you there!`;

  return (
    <>
      <Link href="/growth/events" className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> All masterclasses
      </Link>
      <PageHeader
        eyebrow="Masterclass"
        title={c.label}
        titleDir="auto"
        subtitle={c.eventAt ? `On ${formatCairo(c.eventAt)}` : "No date set: add it on the campaign"}
        actions={
          <Link href={`/growth/campaigns/${c.id}`} className="btn btn-secondary btn-sm">
            Campaign and costs
          </Link>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Registered" value={e.registered} icon="leads" tone="brand" />
        <Stat label="Reminded" value={e.reminded} hint={pct(e.reminded, e.registered)} icon="chat" />
        <Stat label="Came" value={e.attended} hint={`show-up ${pct(e.attended, e.attended + e.noShow)}`} icon="check" />
        <Stat label="Consult after" value={e.consultedAfter} hint={pct(e.consultedAfter, e.attended) + " of those who came"} icon="phone" />
        <Stat label="Enrolled" value={e.enrolled} hint={pct(e.enrolled, e.registered) + " of registrants"} icon="cohorts" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={`Registrants (${people.length})`} icon="leads">
          <Registrants
            campaignId={c.id}
            canWrite={write}
            defaultMessage={defaultMessage}
            rows={people.map((p) => ({ id: p.id, fullName: p.fullName, phone: p.phone, doNotContact: p.doNotContact, attended: p.attended, reminded: !!p.remindedAt, consultedAfter: p.consultedAfter, enrolled: p.enrolled }))}
          />
        </Card>
        <div className="flex flex-col gap-5">
          <Card title="Sign-up" icon="send">
            {forms.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {forms.map((f) => (
                  <li key={f.id}>
                    <a href={`/f/${f.slug}`} target="_blank" rel="noreferrer" className="link num break-all" dir="ltr">
                      {base}/f/{f.slug}
                    </a>
                    {!f.active && <span className="chip ml-2">closed</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No form yet. <Link href="/growth/forms" className="link">Make one</Link> with this campaign so people can register themselves.
              </p>
            )}
            {write && (
              <form action={addRegistrantAction} className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="campaignId" value={c.id} />
                <label className="field min-w-0 flex-1">
                  Register someone by WhatsApp number
                  <input name="phone" required type="tel" dir="ltr" className="input input-sm" />
                </label>
                <button className="btn btn-secondary btn-sm">Register</button>
              </form>
            )}
          </Card>
          {write && (
            <Card title="Follow up after the event" icon="calendar">
              <form action={followUpEventAction} className="grid gap-3">
                <input type="hidden" name="campaignId" value={c.id} />
                <label className="field">
                  Who
                  <select name="who" defaultValue="attended" className="input input-sm">
                    <option value="attended">Everyone who came ({e.attended})</option>
                    <option value="no_show">Everyone who did not come ({e.noShow})</option>
                  </select>
                </label>
                <label className="field">
                  Cadence
                  <select name="templateId" className="input input-sm">
                    {cadences.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-primary btn-sm self-start">Start the cadence</button>
                <p className="text-xs text-muted">Each person gets dated follow-ups on Today. Won and lost leads, do-not-contact, and anyone already in a cadence are skipped.</p>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
