import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getCohort } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { updateCohortAction, updatePaymentAction } from "../actions";
import { closeLabel, egp } from "@/lib/cohort-format";
import { Flash } from "@/components/Flash";
import { Icon, PageHeader } from "@/components/ui";

const box = "input";
const pretty = (s: string) => s.replace(/_/g, " ");

export default async function CohortPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const data = await getCohort(db, id);
  if (!data) notFound();
  const { summary: c, students, byTier } = data;
  const pct = Math.min(100, Math.round((c.seatsUsed / c.seatCap) * 100));
  const over = c.seatsUsed > c.seatCap;

  return (
    <>
      <Link href="/cohorts" className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> All cohorts
      </Link>
      <PageHeader
        eyebrow="Cohort"
        title={c.name}
        titleDir="auto"
        subtitle={closeLabel(c.enrolmentCloseAt)}
        actions={
          can(user.role, "revenue:export") ? (
            <a href={`/cohorts/${c.id}/export`} className="btn btn-secondary btn-sm">
              <Icon name="download" size={14} /> Export enrolments CSV
            </a>
          ) : undefined
        }
      />
      <Flash error={searchParams.error} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium text-muted">Masterclass</div>
          <div>{formatCairo(c.masterclassAt) || "—"}</div>
        </div>
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium text-muted">Enrolment closes</div>
          <div>{formatCairo(c.enrolmentCloseAt) || "—"}</div>
          <div className="text-sm text-accent">{closeLabel(c.enrolmentCloseAt)}</div>
        </div>
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium text-muted">Seats</div>
          <div className={over ? "text-warn" : ""}>
            {c.seatsUsed} of {c.seatCap}
            {over ? " (over cap)" : ""}
          </div>
          <div className="mt-1 h-1.5 rounded bg-bg" role="img" aria-label={`${pct}% of seats used`}>
            <div className="h-1.5 rounded-full bg-gold" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="card p-4">
          <div className="mb-1 text-xs font-medium text-muted">Revenue</div>
          <div>{egp(c.revenueEgp)}</div>
          <div className="mb-1 text-xs font-medium text-muted">{egp(c.collectedEgp)} collected</div>
        </div>
      </div>

      <h2 className="mb-2 font-display text-lg font-semibold">Revenue by tier</h2>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {Object.entries(byTier).map(([tier, v]) => (
          <span key={tier} className="card px-3 py-1.5">
            {pretty(tier)}: {v.count} · {egp(v.egp)}
          </span>
        ))}
        {Object.keys(byTier).length === 0 && <span className="text-muted">No enrolments yet.</span>}
      </div>

      <h2 className="mb-2 font-display text-lg font-semibold">Students ({students.length})</h2>
      <div className="card mb-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Paid</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.enrolmentId} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <Link href={`/leads/${s.leadId}`} className="font-medium hover:text-accent" dir="auto">
                    {s.fullName}
                  </Link>
                </td>
                <td className="px-3 py-2">{pretty(s.tier)}</td>
                <td className="px-3 py-2">{egp(s.amountEgp)}</td>
                <td className="px-3 py-2">{s.paidAt ? formatCairo(s.paidAt, false) : <span className="text-warn">unpaid</span>}</td>
                <td className="px-3 py-2 text-muted" dir="ltr">
                  {s.paymentRef} {s.gateway === "paymob" ? "(paymob)" : ""}
                </td>
                <td className="px-3 py-2">
                  {can(user.role, "payment:write") && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted hover:text-fg">Edit payment</summary>
                      <form action={updatePaymentAction} className="mt-2 flex flex-col gap-2 well p-3">
                        <input type="hidden" name="enrolmentId" value={s.enrolmentId} />
                        <input type="hidden" name="cohortId" value={c.id} />
                        <select name="tier" defaultValue={s.tier} className={box} aria-label="Tier">
                          {["foundation", "freelance_ready", "production_partner"].map((t) => (
                            <option key={t} value={t}>
                              {pretty(t)}
                            </option>
                          ))}
                        </select>
                        <input name="amountEgp" type="number" min={1} defaultValue={s.amountEgp} required className={box} aria-label="Amount (EGP)" />
                        <input name="paidOn" type="date" defaultValue={s.paidAt ? s.paidAt.toISOString().slice(0, 10) : ""} className={box} aria-label="Paid on" />
                        <input name="paymentRef" defaultValue={s.paymentRef ?? ""} placeholder="Reference" dir="ltr" className={box} />
                        <select name="gateway" defaultValue={s.gateway} className={box} aria-label="Gateway">
                          <option value="other">other</option>
                          <option value="paymob">paymob</option>
                        </select>
                        <button className="btn btn-primary self-start">Save</button>
                      </form>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Nobody enrolled yet. Enrol leads from the Pipeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {can(user.role, "settings:write") && (
        <form action={updateCohortAction} className="grid max-w-2xl grid-cols-1 gap-3 card p-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={c.id} />
          <h2 className="font-display text-lg font-semibold sm:col-span-2">Edit cohort</h2>
          <label className="field">
            Name
            <input name="name" defaultValue={c.name} required dir="auto" className={box} />
          </label>
          <label className="field">
            Seat cap
            <input name="seatCap" type="number" min={c.seatsUsed || 1} defaultValue={c.seatCap} required className={box} />
          </label>
          <label className="field">
            Masterclass (Cairo time)
            <input name="masterclassAt" type="datetime-local" defaultValue={toCairoLocalInput(c.masterclassAt)} className={box} />
          </label>
          <label className="field">
            Enrolment closes (Cairo time)
            <input name="enrolmentCloseAt" type="datetime-local" defaultValue={toCairoLocalInput(c.enrolmentCloseAt)} className={box} />
          </label>
          <label className="field">
            Course starts
            <input name="startAt" type="datetime-local" defaultValue={toCairoLocalInput(c.startAt)} className={box} />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary">Save</button>
          </div>
        </form>
      )}
    </>
  );
}
