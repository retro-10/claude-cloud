import Link from "next/link";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, EmptyState, Icon, PageHeader, Stat } from "@/components/ui";
import { ScrollX } from "@/components/ui/ScrollX";
import { getSettings } from "@/lib/app-settings";
import { cashAt, legacyBalances, legacyHistory, oldCycle, reserveTarget, type Position } from "@/lib/cycle";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd, formatCairo } from "@/lib/time";
import { closeCycleAction, recordLegacyAction } from "../rebuild/actions";

export const metadata = { title: "Cycle & legacy · Finance" };

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} EGP`;
const signed = (n: number) => (Math.round(n) > 0 ? `+${egp(n)}` : egp(n));
const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

function SettlementTable({ p, label }: { p: Position; label: string }) {
  return (
    <ScrollX label={label}>
      <table className="table min-w-[880px]">
        <thead>
          <tr>
            <th scope="col">Holder</th>
            <th scope="col" className="text-right">Camp %</th>
            <th scope="col" className="text-right">Core %</th>
            <th scope="col" className="text-right">Share of income</th>
            <th scope="col" className="text-right">Drawn / costs paid</th>
            <th scope="col" className="text-right">Balance</th>
            <th scope="col" className="text-right">Share of Capital&apos;s shortfall</th>
            <th scope="col" className="text-right">After settlement</th>
          </tr>
        </thead>
        <tbody>
          {p.holders.map((h) => (
            <tr key={h.name}>
              <th scope="row" className="font-medium">
                {h.name}
              </th>
              <td className="text-right tabular-nums">{h.campPct}%</td>
              <td className="text-right tabular-nums">{h.corePct}%</td>
              <td className="text-right tabular-nums">{egp(h.share)}</td>
              <td className="text-right tabular-nums">{egp(h.drawn)}</td>
              <td className={`text-right tabular-nums ${h.balance < 0 ? "text-danger" : ""}`}>{signed(h.balance)}</td>
              <td className="text-right tabular-nums text-muted">{Math.round(h.shortfall) ? signed(h.shortfall) : "—"}</td>
              <td className={`text-right font-semibold tabular-nums ${h.settled < -0.5 ? "text-danger" : h.settled > 0.5 ? "text-ok" : ""}`}>{signed(h.settled)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total</th>
            <td />
            <td />
            <td className="text-right font-semibold tabular-nums">{egp(p.income)}</td>
            <td className="text-right font-semibold tabular-nums">{egp(p.costs + p.withdrawals)}</td>
            <td className="text-right font-semibold tabular-nums">{egp(p.cash)}</td>
            <td />
            <td className="text-right font-semibold tabular-nums">{egp(p.cash)} cash</td>
          </tr>
        </tbody>
      </table>
    </ScrollX>
  );
}

// The rebuild's first step: close the old cycle under the old split, settle Capital's shortfall, and carry each
// partner's balance into a separate legacy ledger; the new cycle starts from the cash on hand.
export default async function CyclePage(props: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const [c, s, balances, history, cashNow] = await Promise.all([oldCycle(db), getSettings(db), legacyBalances(db), legacyHistory(db), cashAt(db, new Date())]);
  const owner = can(user.role, "settings:write");
  const write = can(user.role, "payment:write");
  const m = s.financeModel;
  const view = sp.view === "today" ? "today" : "close";
  const today = cairoYmd(new Date());
  const reserve = reserveTarget(m);

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Cycle close & legacy ledger"
        subtitle="The old cycle is divided under the old split; Capital's shortfall is spread over the partners; each partner's balance moves to a separate legacy ledger, settled later. The new cycle starts from the cash on hand."
        actions={
          owner && (
            <Link href="/settings/finance" className="btn btn-ghost btn-sm">
              <Icon name="settings" size={14} /> Rules
            </Link>
          )
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <FinanceNav />

      {!c ? (
        <Card>
          <EmptyState icon="history" title="No cycle close is planned">
            Set the close date in Settings &gt; Finance to divide the old cycle and open the legacy ledger.
          </EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Cash in the business now" value={egp(cashNow)} icon="trend" tone="brand" />
            <Stat label={`Cash at the ${dayLabel(c.closeDate)} close`} value={egp(c.atClose.cash)} hint="with Expected and Owed rows" icon="calendar" />
            <Stat label="Cash reserve target" value={egp(reserve)} hint={`${m.reserveMonths} months of ${egp(reserve / Math.max(1, m.reserveMonths))} fixed costs`} icon="shield" />
            <Stat label="Opening cash above the reserve" value={egp(Math.max(0, c.atClose.cash - reserve))} hint={c.atClose.cash < reserve ? `${egp(reserve - c.atClose.cash)} short` : undefined} icon="gauge" />
          </div>

          <Card
            title={c.closed ? `Closed on ${formatCairo(c.closed.closedAt, false)}` : `Old cycle, closing ${dayLabel(c.closeDate)}`}
            icon="history"
            bodyClass="p-0"
            actions={
              <nav aria-label="Position" className="flex gap-1">
                <Link href="/finance/cycle?view=today" aria-current={view === "today" ? "page" : undefined} className={`btn btn-sm ${view === "today" ? "btn-secondary" : "btn-ghost"}`}>
                  Today
                </Link>
                <Link href="/finance/cycle" aria-current={view === "close" ? "page" : undefined} className={`btn btn-sm ${view === "close" ? "btn-secondary" : "btn-ghost"}`}>
                  At the close
                </Link>
              </nav>
            }
          >
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-5 py-3 text-sm text-muted">
              <span>Camp income {egp((view === "today" ? c.today : c.atClose).campIncome)}</span>
              <span>Core income {egp((view === "today" ? c.today : c.atClose).coreIncome)}</span>
              <span>Business costs {egp((view === "today" ? c.today : c.atClose).costs)}</span>
              <span>Partner withdrawals {egp((view === "today" ? c.today : c.atClose).withdrawals)}</span>
            </div>
            <SettlementTable p={view === "today" ? c.today : c.atClose} label="Settlement" />
            <div className="flex flex-col gap-3 border-t border-line px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted">
                {view === "today" ? "Only money that has moved." : "Including Expected income and Owed bills dated up to the close."} Capital pays every cost; its shortfall is shared at the old Camp percentages scaled to 100%.{" "}
                {c.atClose.check ? <span className="text-ok">Balances add up to the cash.</span> : <span className="text-danger">Balances do not add up to the cash: check the ledger.</span>}
              </p>
              {owner && !c.closed && (
                <form action={closeCycleAction}>
                  <input type="hidden" name="back" value="/finance/cycle" />
                  <ConfirmButton
                    className="btn btn-primary btn-sm"
                    disabled={today <= c.closeDate}
                    title={today <= c.closeDate ? `From ${dayLabel(c.closeDate)} onwards` : undefined}
                    message={`Close the cycle at ${dayLabel(c.closeDate)}? Each partner's balance after settlement opens the legacy ledger. This is kept as a record and is not repeated.`}
                  >
                    <Icon name="check" size={14} /> Close the cycle
                  </ConfirmButton>
                </form>
              )}
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card title="Legacy ledger" icon="layers" bodyClass="p-0">
              {!balances.length ? (
                <EmptyState icon="layers" title="Not opened yet">
                  It opens when the old cycle is closed. Until then, “At the close” above shows what each balance will be.
                </EmptyState>
              ) : (
                <>
                  <ul className="grid gap-3 p-5 sm:grid-cols-2">
                    {balances.map((b) => (
                      <li key={b.partner} className="rounded-xl border border-line p-4">
                        <div className="text-sm font-medium">{b.partner}</div>
                        <div className={`mt-1 font-display text-2xl font-semibold ${b.balance < 0 ? "text-danger" : b.balance > 0 ? "text-ok" : ""}`}>{signed(b.balance)}</div>
                        <div className="text-xs text-muted">{b.balance > 0 ? "owed to the partner" : b.balance < 0 ? `owed by the partner${m.withholdLegacy ? "; withheld from pay" : ""}` : "settled"}</div>
                      </li>
                    ))}
                  </ul>
                  <ScrollX label="Legacy history">
                    <table className="table min-w-[600px]">
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Partner</th>
                          <th scope="col">What</th>
                          <th scope="col" className="text-right">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id}>
                            <td className="whitespace-nowrap text-muted">{formatCairo(h.createdAt, false)}</td>
                            <td>{h.partner}</td>
                            <td>
                              <span className="capitalize">{h.kind}</span>
                              {h.note && <span className="text-muted"> · {h.note}</span>}
                            </td>
                            <td className="text-right tabular-nums">{signed(h.amountEgp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollX>
                </>
              )}
            </Card>
            {write && balances.length > 0 && (
              <Card title="Record a legacy movement" icon="edit">
                <form action={recordLegacyAction} className="flex flex-col gap-3">
                  <input type="hidden" name="back" value="/finance/cycle" />
                  <label className="field">
                    Partner
                    <select name="partner" className="input input-sm">
                      {balances.map((b) => (
                        <option key={b.partner} value={b.partner}>
                          {b.partner} ({signed(b.balance)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="flex flex-col gap-2 text-sm">
                    <legend className="mb-1 text-[13px] font-medium text-muted">What happened</legend>
                    <label className="flex items-start gap-2">
                      <input type="radio" name="kind" value="payment" defaultChecked className="mt-1" />
                      <span>
                        <strong className="font-medium">Payment</strong>: the company paid a partner it owes, or a partner who owes repaid. Booked in the ledger.
                      </span>
                    </label>
                    <label className="flex items-start gap-2">
                      <input type="radio" name="kind" value="adjustment" className="mt-1" />
                      <span>
                        <strong className="font-medium">Adjustment</strong> the partners agreed (no money moves). + raises the balance, − lowers it.
                      </span>
                    </label>
                  </fieldset>
                  <label className="field">
                    Amount (EGP)
                    <input name="amount" required inputMode="numeric" className="input input-sm" placeholder="10,000" />
                  </label>
                  <label className="field">
                    Date
                    <input type="date" name="date" defaultValue={today} className="input input-sm" />
                  </label>
                  <label className="field">
                    Note
                    <input name="note" maxLength={300} className="input input-sm" placeholder="e.g. First instalment, agreed schedule" />
                  </label>
                  <button className="btn btn-primary btn-sm">Record</button>
                </form>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
