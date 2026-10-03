import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { TaskForm, TaskList } from "@/components/tasks/TaskPanel";
import { listTasks } from "@/lib/tasks";
import { attendanceSummary, listClasses } from "@/lib/classes";
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
import { studentRisks } from "@/lib/risk";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { updateCohortAction } from "../actions";
import { ScrollX } from "@/components/ui/ScrollX";

export const metadata = { title: "Batch" };

export default async function CohortPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const [data, batchTasks, people, files, attendance, classes] = await Promise.all([
    getCohort(db, id),
    listTasks(db, { cohortId: id, status: "open" }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    listAttachments(db, { cohortId: id }),
    attendanceSummary(db, id),
    listClasses(db, { cohortId: id }),
  ]);
  if (!data) notFound();
  const { summary: c, students, byTier } = data;
  const pct = Math.min(100, Math.round((c.seatsUsed / c.seatCap) * 100));
  const over = c.seatsUsed > c.seatCap;
  const remaining = students.reduce((a, s) => a + s.remaining, 0);
  const seeMoney = can(user.role, "finance:read");
  const risks = await studentRisks(db, { cohortId: c.id, money: seeMoney });

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
          <span className="flex flex-wrap gap-2">
            <Link href={`/cohorts/${c.id}/graduation`} className="btn btn-secondary btn-sm">
              <Icon name="cohorts" size={14} /> Graduation
            </Link>
            {can(user.role, "revenue:export") ? (
            <a href={`/cohorts/${c.id}/export`} className="btn btn-secondary btn-sm">
              <Icon name="download" size={14} /> Export students CSV
            </a>
          ) : null}
          </span>
        }
      />
      <Flash error={searchParams.error} notice={searchParams.notice} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <Card
        title={`Classes (${classes.length})`}
        icon="calendar"
        className="mb-6"
        actions={
          <Link href={`/classes?batch=${c.id}`} className="btn btn-ghost btn-sm">
            Schedule and attendance
          </Link>
        }
      >
        {classes.length === 0 ? (
          <p className="text-sm text-muted">No classes scheduled yet. Add them on the Classes page, or copy another batch&rsquo;s schedule.</p>
        ) : (
          <p className="text-sm">
            {classes.filter((x) => x.startsAt < new Date()).length} held, {classes.filter((x) => x.startsAt >= new Date()).length} to come
            {(() => {
              const next = classes.find((x) => x.startsAt >= new Date());
              return next ? ` · next: ${next.title}, ${formatCairo(next.startsAt)}` : "";
            })()}
          </p>
        )}
      </Card>

      <div id="risk" className="scroll-mt-24" />
      <Card title="Early warning" icon="alert" label="Early warning: students likely to drop" className="mb-6">
        {risks.length === 0 ? (
          <p className="text-sm text-muted">No active student shows warning signs: attendance, the last two classes, work past due{seeMoney ? " and payments" : ""} all look fine.</p>
        ) : (
          <>
            <ul className="grid gap-3 md:grid-cols-2">
              {risks.map((r) => (
                <li key={r.enrolmentId} className="rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/leads/${r.leadId}#programme`} className="font-medium hover:text-accent" dir="auto">
                      {r.fullName}
                    </Link>
                    <span className={`chip ${r.level === "risk" ? "chip-danger" : "chip-warn"}`}>
                      {r.level === "risk" ? "At risk" : "Watch"} · {r.score}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-1 text-sm text-muted">
                    {r.reasons.map((x) => (
                      <li key={x} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                        {x}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">A simple score from attendance, missed classes, overdue work{seeMoney ? ", stale rework and overdue instalments" : " and stale rework"}. 50 or more is at risk, 25 to 49 worth watching. Reach out early: a check-in call works better than a reminder.</p>
          </>
        )}
      </Card>

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
          <ScrollX label={`Students (${students.length})`}>
            <table className="table min-w-[1000px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Tier</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className="text-right">Attendance</th>
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
                    <td className="num text-right">{(() => {
                      const a = attendance.get(s.enrolmentId);
                      return a?.rate == null ? "—" : <span className={a.rate < 0.75 ? "text-warn" : ""} title={`${a.present} present, ${a.late} late, ${a.absent} absent, ${a.excused} excused`}>{Math.round(a.rate * 100)}%</span>;
                    })()}</td>
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
          </ScrollX>
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
