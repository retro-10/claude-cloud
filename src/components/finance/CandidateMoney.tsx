import Link from "next/link";
import { deleteEntryAction, recordPaymentAction, settleEntryAction, updateCandidateAction } from "@/app/(app)/finance/actions";
import { PAYMENT_PLAN_LABEL, STATUS_LABEL, STUDENT_STATUS_LABEL, type CandidateRow, type Entry } from "@/lib/finance";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { Icon } from "../ui";

const egp = (n: number) => `${new Intl.NumberFormat("en-US").format(Math.round(n))} EGP`;
const TIERS = [
  ["foundation", "Foundation"],
  ["freelance_ready", "Freelance Ready"],
  ["production_partner", "Production Partner"],
] as const;

/** Paid vs remaining as one bar (paid in the accent, expected hatched, rest empty). */
export function PaidBar({ c }: { c: Pick<CandidateRow, "due" | "paid" | "expected"> }) {
  if (!c.due) return <span className="chip">free seat</span>;
  const paid = Math.min(100, (c.paid / c.due) * 100);
  const exp = Math.min(100 - paid, (c.expected / c.due) * 100);
  return (
    <div className="flex h-2 w-full min-w-[6rem] gap-[2px] overflow-hidden rounded-full bg-raised" role="img" aria-label={`${Math.round(paid)}% paid`}>
      {paid > 0 && <span className="bg-brand" style={{ width: `${paid}%` }} />}
      {exp > 0 && <span className="bg-[repeating-linear-gradient(135deg,rgb(var(--brand)/0.5)_0_3px,transparent_3px_6px)]" style={{ width: `${exp}%` }} />}
    </div>
  );
}

/**
 * One candidate's money: what they owe, what came in, what is still expected, every payment, and (for owner
 * and finance) record a payment, schedule an installment or change the plan. `back` returns here after saving.
 */
export function CandidateMoney({ c, payments, canWrite, back }: { c: CandidateRow; payments: (Entry & { candidate?: string | null })[]; canWrite: boolean; back: string }) {
  const done = c.due > 0 && c.remaining === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 text-sm">
        {[
          ["Due", egp(c.due), c.discountEgp ? `after ${egp(c.discountEgp)} off` : PAYMENT_PLAN_LABEL[c.paymentPlan]],
          ["Paid", egp(c.paid), done ? "fully paid" : `${c.due ? Math.round((c.paid / c.due) * 100) : 100}%`],
          ["Remaining", egp(c.remaining), c.nextDue ? `next ${formatCairo(c.nextDue, false)}` : c.expected ? "expected, no date" : "nothing scheduled"],
        ].map(([k, v, h]) => (
          <div key={k} className="well px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className={`num font-semibold ${k === "Remaining" && c.remaining > 0 ? "text-warn" : ""}`}>{v}</div>
            <div className="text-[11px] text-muted">{h}</div>
          </div>
        ))}
      </div>
      <PaidBar c={c} />
      <ul className="divide-y divide-line/70 rounded-lg border border-line">
        {payments.length === 0 && <li className="px-3 py-3 text-sm text-muted">No payments recorded.</li>}
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className={`chip ${p.status === "received" ? "chip-ok" : p.status === "expected" ? "chip-warn" : ""}`}>{STATUS_LABEL[p.status]}</span>
            <span className="num font-medium">{p.category === "Refund" ? "−" : ""}{egp(p.amountEgp)}</span>
            <span className="text-xs text-muted">
              {formatCairo(p.date ?? p.createdAt, false) || "no date"}
              {p.reference ? ` · ref ${p.reference}` : ""}
            </span>
            {canWrite && (
              <span className="ml-auto flex gap-1">
                {p.status === "expected" && (
                  <form action={settleEntryAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn btn-secondary btn-sm">
                      <Icon name="check" size={12} /> Received
                    </button>
                  </form>
                )}
                <form action={deleteEntryAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="btn btn-ghost btn-sm w-7 px-0 hover:text-danger" aria-label="Delete payment" title="Delete">
                    <Icon name="x" size={12} />
                  </button>
                </form>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="flex flex-col gap-2">
          <form action={recordPaymentAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="enrolmentId" value={c.enrolmentId} />
            <input type="hidden" name="back" value={back} />
            <label className="field w-28">
              Amount
              <input name="amountEgp" inputMode="numeric" required defaultValue={c.remaining || ""} className="input num" />
            </label>
            <label className="field">
              Date
              <input name="date" type="date" className="input w-auto" />
            </label>
            <label className="field min-w-[8rem] flex-1">
              Reference
              <input name="reference" dir="ltr" className="input" placeholder="Transfer / receipt" />
            </label>
            <select name="status" aria-label="Received or expected" className="input w-auto" defaultValue="received">
              <option value="received">Received</option>
              <option value="expected">Expected (installment)</option>
            </select>
            <button className="btn btn-primary">
              <Icon name="plus" size={14} /> Add
            </button>
          </form>
          <details>
            <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
              <Icon name="edit" size={12} /> Plan, price and status
            </summary>
            <form action={updateCandidateAction} className="well mt-2 grid grid-cols-2 gap-2 p-3">
              <input type="hidden" name="enrolmentId" value={c.enrolmentId} />
              <input type="hidden" name="back" value={back} />
              <label className="field">
                Tier
                <select name="tier" defaultValue={c.tier} className="input">
                  {TIERS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Plan
                <select name="paymentPlan" defaultValue={c.paymentPlan} className="input">
                  {Object.entries(PAYMENT_PLAN_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Price (EGP)
                <input name="amountEgp" inputMode="numeric" defaultValue={c.amountEgp} className="input num" />
              </label>
              <label className="field">
                Discount (EGP)
                <input name="discountEgp" inputMode="numeric" defaultValue={c.discountEgp} className="input num" />
              </label>
              <label className="field">
                Final installment
                <input name="finalInstalmentAt" type="date" defaultValue={c.finalInstalmentAt ? toCairoLocalInput(c.finalInstalmentAt).slice(0, 10) : ""} className="input" />
              </label>
              <label className="field">
                Student status
                <select name="status" defaultValue={c.status} className="input">
                  {Object.entries(STUDENT_STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-secondary col-span-2 justify-self-start">Save</button>
            </form>
          </details>
        </div>
      )}
      <Link href={`/finance/ledger?candidate=${c.enrolmentId}`} className="text-xs text-muted hover:text-fg">
        See in the ledger →
      </Link>
    </div>
  );
}
