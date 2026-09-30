import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { TaskForm, TaskList } from "@/components/tasks/TaskPanel";
import { listTasks } from "@/lib/tasks";
import { FilesPanel } from "@/components/FilesPanel";
import { listAttachments } from "@/lib/attachments";
import { Flash } from "@/components/Flash";
import { PaidBar } from "@/components/finance/CandidateMoney";
import { Card, EmptyState, Icon, PageHeader, Stat, pretty } from "@/components/ui";
import { closeLabel, egp } from "@/lib/cohort-format";
import { getCohort } from "@/lib/cohorts";
import { PAYMENT_PLAN_LABEL, STUDENT_STATUS_LABEL } from "@/lib/finance";
import { TIER_LABEL } from "@/lib/pricing";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { updateCohortAction } from "../actions";

export const metadata = { title: "Batch" };

export default async function CohortPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const [data, batchTasks, people, files] = await Promise.all([
    getCohort(db, id),
    listTasks(db, { cohortId: id, status: "open" }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    listAttachments(db, { cohortId: id }),
  ]);
  if (!data) notFound();
  const { summary: c, students, byTier } = data;
  const pct = Math.min(100, Math.round((c.seatsUsed / c.seatCap) * 100));
  const over = c.seatsUsed > c.seatCap;
  const remaining = students.reduce((a, s) => a + s.remaining, 0);
  const seeMoney = can(user.role, "finance:read");

  return (
    <>
      <Link href="/cohorts" className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> All batches
      </Link>
      <PageHeader
        eyebrow={`Batch · ${c.status}`}
        title={c.name}
        titleDir="auto"
        subtitle={closeLabel(c.enrolmentCloseAt)}
        actions={
          can(user.role, "revenue:export") ? (
            <a href={`/cohorts/${c.id}/export`} className="btn btn-secondary btn-sm">
              <Icon name="download" size={14} /> Export students CSV
            </a>
          ) : undefined
        }
      />
      <Flash error={searchParams.error} notice={searchParams.notice} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Seats" value={`${c.seatsUsed} / ${c.seatCap}`} hint={over ? "over the cap" : `${c.seatCap - c.seatsUsed} left`} icon="cohorts" />
        <Stat label="Enrolment" value={closeLabel(c.enrolmentCloseAt)} hint={c.enrolmentCloseAt ? `closes ${formatCairo(c.enrolmentCloseAt)}` : "no close date"} icon="calendar" />
        {seeMoney && <Stat label="Owed by students" value={egp(c.revenueEgp)} hint={`${egp(c.collectedEgp)} collected`} icon="trend" tone="brand" />}
        {seeMoney && <Stat label="Still to collect" value={egp(remaining)} hint={`${students.filter((s) => s.remaining > 0).length} students with a balance`} icon="hourglass" />}
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${pct}% of seats taken`}>
        <div className={`h-full rounded-full ${over ? "bg-warn" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {Object.entries(byTier).map(([tier, v]) => (
          <span key={tier} className="chip px-3 py-1 text-xs">
            {TIER_LABEL[tier] ?? tier} · {v.count}{seeMoney ? ` · ${egp(v.egp)}` : ""}
          </span>
        ))}
      </div>

      <Card title={`Tasks for this batch (${batchTasks.length})`} icon="list" className="mb-6">
        <TaskList rows={batchTasks} back={`/cohorts/${c.id}`} canWrite={can(user.role, "task:write")} showLinks={false} empty="No open tasks for this batch." />
        {can(user.role, "task:write") && (
          <div className="mt-3">
            <TaskForm people={people} back={`/cohorts/${c.id}`} cohortId={c.id} me={user.id} />
          </div>
        )}
      </Card>

      <Card title={`Files (${files.length})`} icon="layers" className="mb-6">
        <FilesPanel rows={files} back={`/cohorts/${c.id}`} cohortId={c.id} canWrite={can(user.role, "file:write")} me={user.id} isOwner={can(user.role, "settings:write")} />
      </Card>

      <Card title={`Students (${students.length})`} icon="leads" bodyClass="p-0" className="mb-6">
        {students.length === 0 ? (
          <EmptyState icon="cohorts" title="Nobody enrolled yet">Enrol leads from the Pipeline or a lead’s stage bar.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Tier</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className="text-right">QC</th>
                  <th className="text-right">Rank</th>
                  <th>Consent</th>
                  {seeMoney && <th className="w-40">Paid</th>}
                  {seeMoney && <th className="text-right">Remaining</th>}
                  {seeMoney && <th>Next due</th>}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.enrolmentId}>
                    <td>
                      <Link href={`/leads/${s.leadId}#money`} className="font-medium hover:text-accent" dir="auto">
                        {s.fullName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{TIER_LABEL[s.tier] ?? s.tier}</td>
                    <td>
                      <span className={`chip ${s.paymentPlan === "installments" ? "chip-warn" : ""}`}>{PAYMENT_PLAN_LABEL[s.paymentPlan]}</span>
                    </td>
                    <td>
                      <span className={`chip ${s.status === "active" ? "chip-ok" : s.status === "dropped" ? "chip-danger" : "chip-brand"}`}>{STUDENT_STATUS_LABEL[s.status]}</span>
                    </td>
                    <td className="num text-right">{s.qcScore ?? "—"}</td>
                    <td className="num text-right">{s.leaderboardRank ? `#${s.leaderboardRank}` : "—"}</td>
                    <td>
                      <Link href={`/leads/${s.leadId}#programme`} className={`chip ${s.contentConsent ? "chip-ok" : ""}`} title={s.contentConsentScope.join(", ") || undefined}>
                        {s.contentConsent ? "on file" : "none"}
                      </Link>
                    </td>
                    {seeMoney && (
                      <td>
                        <div className="flex items-center gap-2">
                          <PaidBar c={s} />
                          <span className="num whitespace-nowrap text-xs text-muted">{s.due ? `${Math.round((s.paid / s.due) * 100)}%` : ""}</span>
                        </div>
                      </td>
                    )}
                    {seeMoney && <td className={`num whitespace-nowrap text-right ${s.remaining ? "text-warn" : "text-muted"}`}>{egp(s.remaining)}</td>}
                    {seeMoney && <td className="num whitespace-nowrap text-muted">{s.nextDue ? formatCairo(s.nextDue, false) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {can(user.role, "settings:write") && (
        <form action={updateCohortAction} className="card grid max-w-3xl grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <input type="hidden" name="id" value={c.id} />
          <h2 className="font-display text-lg font-semibold sm:col-span-2">Edit batch</h2>
          <label className="field">
            Name
            <input name="name" defaultValue={c.name} required dir="auto" className="input" />
          </label>
          <label className="field">
            Seat cap (the real QC capacity)
            <input name="seatCap" type="number" min={c.seatsUsed || 1} defaultValue={c.seatCap} required className="input" />
          </label>
          <label className="field">
            Status
            <select name="status" defaultValue={c.status} className="input">
              <option value="planning">Planning</option>
              <option value="live">Live</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="field">
            Enrolment opens (Cairo time)
            <input name="openAt" type="datetime-local" defaultValue={toCairoLocalInput(c.openAt)} className="input" />
          </label>
          <label className="field">
            Enrolment closes (Cairo time)
            <input name="enrolmentCloseAt" type="datetime-local" defaultValue={toCairoLocalInput(c.enrolmentCloseAt)} className="input" />
          </label>
          <label className="field">
            Masterclass (Cairo time)
            <input name="masterclassAt" type="datetime-local" defaultValue={toCairoLocalInput(c.masterclassAt)} className="input" />
          </label>
          <label className="field">
            Course starts
            <input name="startAt" type="datetime-local" defaultValue={toCairoLocalInput(c.startAt)} className="input" />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      )}
    </>
  );
}
