import Link from "next/link";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, Icon, PageHeader } from "@/components/ui";
import { ScrollX } from "@/components/ui/ScrollX";
import { getSettings } from "@/lib/app-settings";
import { fixedTotal, listFunctions, reviewsFor, salaries, trigger, waterfall } from "@/lib/cycle";
import { monthRange, shiftMonth, thisMonth } from "@/lib/finance";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { approvePayAction, savePartnerReviewAction, undoPayAction } from "../rebuild/actions";

export const metadata = { title: "Partner pay · Finance" };

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} EGP`;
const monthName = (ym: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T12:00:00Z`));

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="card">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${done ? "bg-ok/20 text-ok" : "bg-brand/15 text-accent"}`}>
          {done ? <Icon name="check" size={14} /> : n}
        </span>
        <h2 id={`step-${n}`} className="card-title">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <span className={strong ? "font-medium" : "text-muted"}>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

// The monthly partner review, as one guided page: what came in and went out, each partner's KPI score, the
// waterfall that follows from the rules, then approval (which books the pay as Owed; nothing is paid by itself).
export default async function PayPage(props: { searchParams: Promise<{ month?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : shiftMonth(thisMonth(), -1);
  const [w, s, fns, reviews] = await Promise.all([waterfall(db, month), getSettings(db), listFunctions(db), reviewsFor(db, month)]);
  const m = s.financeModel;
  const owner = can(user.role, "settings:write");
  const sal = salaries(m, m.newShares.map((p) => p.name), fns);
  const locked = !!w.approved;
  const over = month < thisMonth();
  const back = `/finance/pay?month=${month}`;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Partner pay"
        subtitle="The monthly partner review: costs first, then the cash reserve, base pay once income unlocks a tier, KPI pay from the review, 20% kept, the rest shared equally."
        actions={
          <nav aria-label="Month" className="flex items-center gap-1">
            <Link href={`/finance/pay?month=${shiftMonth(month, -1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month">
              <Icon name="chevronLeft" size={14} />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{monthName(month)}</span>
            <Link href={`/finance/pay?month=${shiftMonth(month, 1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Next month">
              <Icon name="chevronRight" size={14} />
            </Link>
          </nav>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <FinanceNav />

      {!w.inNewCycle ? (
        <Card>
          <p className="text-sm text-muted">
            {monthName(month)} is before the new cycle (it starts after the {m.closeDate} close). Old-cycle money is settled on <Link href="/finance/cycle" className="text-accent underline">Cycle &amp; legacy</Link>.
          </p>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Step n={1} title="Money in and out" done={over}>
              <Line label="Collected income" value={egp(w.income)} hint={w.from > monthRange(month)[0] ? `new cycle from ${formatCairo(w.from, false)}` : undefined} />
              <Line label="Costs paid (fixed and variable)" value={egp(w.costs)} hint={`The model's fixed costs are ${egp(fixedTotal(m))} a month`} />
              <Line label="Cash after costs" value={egp(w.cashAfterCosts)} strong />
              <Line label="Cash in the business at the start" value={egp(w.cashAtStart)} />
              <p className="mt-3 text-xs text-muted">
                Only Received and Paid rows count. Check the month in the{" "}
                <Link href={`/finance/ledger?month=${month}`} className="text-accent underline">
                  ledger
                </Link>{" "}
                first: anything still Expected or Owed is not in these figures.
              </p>
            </Step>

            <Step n={2} title="Partner review (KPI scores)" done={!w.missingScores.length && reviews.length > 0}>
              {w.tier === 0 ? (
                <p className="text-sm text-muted">No pay tier is unlocked this month, so no KPI pay is due. Scores can still be kept for the record.</p>
              ) : null}
              <form action={savePartnerReviewAction} className="mt-2 flex flex-col gap-3">
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="back" value={back} />
                {m.newShares.map((p) => {
                  const prof = m.partners.find((x) => x.name === p.name);
                  const r = reviews.find((x) => x.partner === p.name);
                  return (
                    <fieldset key={p.name} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                      <legend className="sr-only">{p.name}</legend>
                      <input type="hidden" name="partner" value={p.name} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {p.name} <span className="font-normal text-muted">· {prof?.role || "Partner"}</span>
                        </div>
                        <div className="text-xs text-muted">Judged on: {prof?.outcome || "the outcome numbers in the role brief"}</div>
                        <label className="sr-only" htmlFor={`notes-${p.name}`}>
                          Notes for {p.name}
                        </label>
                        <input id={`notes-${p.name}`} name="notes" defaultValue={r?.notes ?? ""} maxLength={1000} disabled={locked || !owner} placeholder="What was delivered" className="input input-sm mt-2" />
                      </div>
                      <label className="field">
                        Score %
                        <input name="score" type="number" min={0} max={100} step={1} required defaultValue={r?.kpiScore ?? ""} disabled={locked || !owner} className="input input-sm num" />
                      </label>
                    </fieldset>
                  );
                })}
                {owner && !locked && (
                  <div>
                    <button className="btn btn-primary btn-sm">Save scores</button>
                  </div>
                )}
              </form>
            </Step>

            <Step n={3} title="The waterfall" done={locked}>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <Line label="Cash after costs" value={egp(w.cashAfterCosts)} />
                  <Line label="Into the cash reserve" value={egp(w.reserveTopUp)} hint={`Target ${egp(w.reserveTarget)}`} />
                  <Line
                    label="Pay tier unlocked"
                    value={w.tier ? `Tier ${w.tier} (${egp(w.pool)} pool)` : "None"}
                    hint={w.tierIncome.map((t) => `${monthName(t.month)}: ${egp(t.income)}`).join(" · ")}
                  />
                  <Line label="Base pay" value={egp(w.basePaid)} />
                  <Line label="KPI pay" value={egp(w.kpiPaid)} hint={w.kpiPaid < w.kpiEarned ? `${egp(w.kpiEarned)} earned; limited to the cash left` : undefined} />
                  <Line label="Profit after pay" value={egp(w.profit)} strong />
                  <Line label={`Kept in the company (${m.retainPct}%)`} value={egp(w.retained)} />
                  <Line label="Shared equally" value={egp(w.distributable)} strong />
                </div>
                <ScrollX label="Pay per partner">
                  <table className="table min-w-[460px]">
                    <thead>
                      <tr>
                        <th scope="col">Partner</th>
                        <th scope="col" className="text-right">Base</th>
                        <th scope="col" className="text-right">KPI</th>
                        <th scope="col" className="text-right">Share</th>
                        <th scope="col" className="text-right">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.partners.map((p) => (
                        <tr key={p.name}>
                          <th scope="row" className="font-medium">
                            {p.name}
                            {p.kpiScore !== null && <span className="block text-xs font-normal text-muted">score {p.kpiScore}%</span>}
                          </th>
                          <td className="text-right tabular-nums">{egp(p.base)}</td>
                          <td className="text-right tabular-nums">{egp(p.kpiPaid)}</td>
                          <td className="text-right tabular-nums">{egp(p.distribution)}</td>
                          <td className="text-right font-semibold tabular-nums">
                            {egp(p.paid)}
                            {p.withheld > 0.5 && <span className="block text-xs font-normal text-danger">{egp(p.withheld)} withheld (legacy)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollX>
              </div>
            </Step>

            <Step n={4} title="Approve" done={locked}>
              {locked ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm">
                    Approved on {formatCairo(w.approved!.approvedAt)}. Each partner&apos;s pay is in the{" "}
                    <Link href={`/finance/ledger?month=${month}`} className="text-accent underline">
                      ledger
                    </Link>{" "}
                    as Owed: mark it Paid when the money moves.
                  </p>
                  {owner && (
                    <form action={undoPayAction}>
                      <input type="hidden" name="month" value={month} />
                      <ConfirmButton className="btn btn-ghost btn-sm" message="Undo this approval? The Owed pay rows are removed and withheld amounts go back to the legacy ledger.">
                        Undo approval
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted">
                    {!over
                      ? "A month is approved once it is over."
                      : w.missingScores.length
                        ? `Score ${w.missingScores.join(", ")} first.`
                        : "Approving books each partner's pay as Owed in the ledger (nothing is paid automatically) and moves withheld pay into the legacy ledger."}
                  </p>
                  {owner && (
                    <form action={approvePayAction}>
                      <input type="hidden" name="month" value={month} />
                      <ConfirmButton className="btn btn-primary btn-sm" disabled={!over || w.missingScores.length > 0} message={`Approve the partner pay for ${monthName(month)}?`}>
                        <Icon name="check" size={14} /> Approve pay
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              )}
            </Step>
          </div>

          <aside className="flex flex-col gap-6">
            <Card title="Pay tiers" icon="target" bodyClass="p-0">
              <ScrollX label="Pay tiers">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Tier</th>
                      <th scope="col" className="text-right">Income needed</th>
                      <th scope="col" className="text-right">Pool</th>
                      <th scope="col" className="text-right">Seats</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.tiers.map((t, i) => (
                      <tr key={i} className={w.tier === i + 1 ? "bg-brand/5" : ""}>
                        <th scope="row">Tier {i + 1}</th>
                        <td className="text-right tabular-nums">{egp(trigger(m, t.pool))}</td>
                        <td className="text-right tabular-nums">{egp(t.pool)}</td>
                        <td className="text-right tabular-nums">{Math.ceil(trigger(m, t.pool) / m.seatPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
              <p className="border-t border-line px-5 py-3 text-xs text-muted">
                Income needed = (fixed costs + pool) × {m.triggerBuffer}, rounded to {egp(m.triggerRound)}, {m.monthsRunning} months running. Seats at {egp(m.seatPrice)}; the Exocad fee (
                {egp(m.exocadFeePerCase)} a case) and the {m.agentCommissionPct}% agent commission are not in the seat count.
              </p>
            </Card>
            <Card title="Salary X per tier" icon="user" bodyClass="p-0">
              <ScrollX label="Salaries">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Partner</th>
                      <th scope="col" className="text-right">Load</th>
                      {m.tiers.map((_, i) => (
                        <th key={i} scope="col" className="text-right">
                          T{i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sal.map((p) => (
                      <tr key={p.name}>
                        <th scope="row">{p.name}</th>
                        <td className="text-right tabular-nums">
                          {p.accountable}
                          {p.multiplier !== 1 && <span className="text-muted"> ×{p.multiplier}</span>}
                        </td>
                        {p.x.map((x, i) => (
                          <td key={i} className="text-right tabular-nums">
                            {x.toLocaleString("en-US")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollX>
              <p className="border-t border-line px-5 py-3 text-xs text-muted">
                X is split by accountable load from{" "}
                <Link href="/team/functions" className="text-accent underline">
                  Functions &amp; owners
                </Link>
                . Base = X × {Math.round(m.baseFraction * 100)}%; KPI pay up to X × {m.kpiMax} at a 100% score.
              </p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
