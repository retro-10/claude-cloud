import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { getCohort } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { updateCohortAction, updatePaymentAction } from "../actions";
import { closeLabel, egp } from "@/lib/cohort-format";

const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";
const pretty = (s: string) => s.replace(/_/g, " ");

export default async function CohortPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
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
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl" dir="auto">
          {c.name}
        </h1>
        <Link href="/cohorts" className="text-xs text-muted underline">
          All cohorts
        </Link>
        {can(user.role, "revenue:export") && (
          <a href={`/cohorts/${c.id}/export`} className="ml-auto text-xs text-muted underline">
            Export enrolments CSV
          </a>
        )}
      </div>
      {searchParams.error && (
        <p role="alert" className="mb-3 text-sm text-red-500">
          {searchParams.error}
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-line bg-surface p-3">
          <div className="text-xs text-muted">Masterclass</div>
          <div>{formatCairo(c.masterclassAt) || "—"}</div>
        </div>
        <div className="rounded border border-line bg-surface p-3">
          <div className="text-xs text-muted">Enrolment closes</div>
          <div>{formatCairo(c.enrolmentCloseAt) || "—"}</div>
          <div className="text-sm text-gold">{closeLabel(c.enrolmentCloseAt)}</div>
        </div>
        <div className="rounded border border-line bg-surface p-3">
          <div className="text-xs text-muted">Seats</div>
          <div className={over ? "text-amber-400" : ""}>
            {c.seatsUsed} of {c.seatCap}
            {over ? " (over cap)" : ""}
          </div>
          <div className="mt-1 h-1.5 rounded bg-bg" role="img" aria-label={`${pct}% of seats used`}>
            <div className="h-1.5 rounded bg-gold" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded border border-line bg-surface p-3">
          <div className="text-xs text-muted">Revenue</div>
          <div>{egp(c.revenueEgp)}</div>
          <div className="text-xs text-muted">{egp(c.collectedEgp)} collected</div>
        </div>
      </div>

      <h2 className="mb-2 font-display text-lg">Revenue by tier</h2>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {Object.entries(byTier).map(([tier, v]) => (
          <span key={tier} className="rounded border border-line bg-surface px-3 py-1.5">
            {pretty(tier)}: {v.count} · {egp(v.egp)}
          </span>
        ))}
        {Object.keys(byTier).length === 0 && <span className="text-muted">No enrolments yet.</span>}
      </div>

      <h2 className="mb-2 font-display text-lg">Students ({students.length})</h2>
      <div className="mb-6 overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
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
                  <Link href={`/leads/${s.leadId}`} className="font-medium hover:text-gold" dir="auto">
                    {s.fullName}
                  </Link>
                </td>
                <td className="px-3 py-2">{pretty(s.tier)}</td>
                <td className="px-3 py-2">{egp(s.amountEgp)}</td>
                <td className="px-3 py-2">{s.paidAt ? formatCairo(s.paidAt, false) : <span className="text-amber-400">unpaid</span>}</td>
                <td className="px-3 py-2 text-muted" dir="ltr">
                  {s.paymentRef} {s.gateway === "paymob" ? "(paymob)" : ""}
                </td>
                <td className="px-3 py-2">
                  {can(user.role, "payment:write") && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted hover:text-fg">Edit payment</summary>
                      <form action={updatePaymentAction} className="mt-2 flex flex-col gap-2 rounded border border-line bg-bg p-2">
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
                        <button className="self-start rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Save</button>
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
        <form action={updateCohortAction} className="grid max-w-2xl grid-cols-1 gap-3 rounded border border-line bg-surface p-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={c.id} />
          <h2 className="font-display text-lg sm:col-span-2">Edit cohort</h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Name
            <input name="name" defaultValue={c.name} required dir="auto" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Seat cap
            <input name="seatCap" type="number" min={c.seatsUsed || 1} defaultValue={c.seatCap} required className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Masterclass (Cairo time)
            <input name="masterclassAt" type="datetime-local" defaultValue={toCairoLocalInput(c.masterclassAt)} className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Enrolment closes (Cairo time)
            <input name="enrolmentCloseAt" type="datetime-local" defaultValue={toCairoLocalInput(c.enrolmentCloseAt)} className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Course starts
            <input name="startAt" type="datetime-local" defaultValue={toCairoLocalInput(c.startAt)} className={box} />
          </label>
          <div className="flex items-end">
            <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Save</button>
          </div>
        </form>
      )}
    </>
  );
}
