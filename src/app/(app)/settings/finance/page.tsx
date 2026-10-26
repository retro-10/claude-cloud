import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { DEFAULTS, getSettings } from "@/lib/app-settings";
import { requirePageCan } from "@/lib/server-auth";
import { saveInvoiceDetailsAction, saveSplitAction } from "../../finance/actions";
import { saveDecisionRightsAction, saveFinanceModelAction, savePricesAction } from "../../finance/rebuild/actions";
import { fixedTotal, reserveTarget, trigger } from "@/lib/cycle";

export const metadata = { title: "Finance · Settings" };

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} EGP`;

export default async function FinanceSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const { financeSplit: split, invoiceDetails: inv, financeModel: m, prices, decisionRights } = await getSettings(db);
  const names = m.newShares.map((p) => p.name);
  const fixedRows = [...m.fixedCosts, null, null];
  const tierRows = [...m.tiers.map((t) => t.pool), null];
  const rightsRows = [...decisionRights, null, null];
  const rows = [...split.partners, ...Array(Math.max(0, 6 - split.partners.length)).fill(null)] as ({ name: string; pct: number } | null)[];
  const def = DEFAULTS.financeSplit;

  return (
    <>
      <Flash {...sp} />
      <Card title="Old split: Camp income" icon="trend" className="max-w-2xl">
        <p className="mb-4 text-sm text-muted">
          The old cycle&apos;s split of Camp income (up to the close date). Costs are paid out of Capital, and a partner withdrawal is an advance on that partner’s share. All
          percentages together must add up to 100. The Core (design house) split and the new cycle&apos;s rules are below. Default: {def.partners.map((p) => `${p.name} ${p.pct}`).join(" · ")} · Capital {def.capitalPct}.
        </p>
        <form action={saveSplitAction} className="flex flex-col gap-2">
          <input type="hidden" name="back" value="/settings/finance" />
          <div className="grid grid-cols-[1fr_7rem] gap-2 text-xs font-medium text-muted">
            <span>Partner</span>
            <span>Share %</span>
          </div>
          {rows.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem] gap-2">
              <input name="partnerName" defaultValue={p?.name ?? ""} aria-label={`Partner ${i + 1} name`} maxLength={40} dir="auto" className="input" />
              <input name="partnerPct" type="number" min={0} max={100} step="0.5" defaultValue={p?.pct ?? ""} aria-label={`Partner ${i + 1} share`} className="input num" />
            </div>
          ))}
          <div className="grid grid-cols-[1fr_7rem] items-center gap-2 border-t border-line pt-3">
            <span className="text-sm font-medium">Capital (pays the costs)</span>
            <input name="capitalPct" type="number" min={0} max={100} step="0.5" defaultValue={split.capitalPct} required aria-label="Capital share" className="input num" />
          </div>
          <p className="text-xs text-muted">Leave a name empty to remove that partner. Renaming a partner does not rename past withdrawals in the ledger.</p>
          <div>
            <button className="btn btn-primary">Save split</button>
          </div>
        </form>
      </Card>
      <Card title="The rebuild: cycle close, shares and partner pay" icon="layers" className="mt-5">
        <p className="mb-4 text-sm text-muted">
          Set here or taken from the Cycle Close workbook (Finance &gt; Import workbook). Every figure can be changed; the Cycle &amp; legacy and Partner pay pages recalculate from these. Fixed costs{" "}
          {egp(fixedTotal(m))} a month; reserve target {egp(reserveTarget(m))}; tier triggers {m.tiers.map((t) => egp(trigger(m, t.pool))).join(" · ")}.
        </p>
        <form action={saveFinanceModelAction} className="flex flex-col gap-6">
          <input type="hidden" name="back" value="/settings/finance" />
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">The cycle</legend>
            <label className="field">
              Close date (old cycle ends)
              <input type="date" name="closeDate" defaultValue={m.closeDate ?? ""} className="input input-sm" />
            </label>
            <label className="field">
              Kept in the company (% of profit)
              <input type="number" name="retainPct" min={0} max={100} step="0.5" required defaultValue={m.retainPct} className="input input-sm num" />
            </label>
            <label className="field">
              Cash reserve (months of fixed costs)
              <input type="number" name="reserveMonths" min={0} max={24} step="0.5" required defaultValue={m.reserveMonths} className="input input-sm num" />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="withholdLegacy" defaultChecked={m.withholdLegacy} className="check" /> Withhold pay due to a partner who owes the legacy ledger, until it is repaid
            </label>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Partners</legend>
            <div className="overflow-x-auto" role="region" aria-label="Partners" tabIndex={0}>
              <table className="table min-w-[1180px]">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Old Core %</th>
                    <th scope="col">New share %</th>
                    <th scope="col">Role</th>
                    <th scope="col">Outcome numbers (KPI)</th>
                    <th scope="col">Load multiplier</th>
                    <th scope="col">Rounding</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((name, i) => {
                    const prof = m.partners.find((p) => p.name === name);
                    return (
                      <tr key={name} className="align-top">
                        <td>
                          <input name="shareName" defaultValue={name} required maxLength={40} aria-label={`Partner ${i + 1}`} className="input input-sm w-28" />
                        </td>
                        <td>
                          <input name="corePct" type="number" min={0} max={100} step="0.5" defaultValue={m.coreSplit.partners.find((p) => p.name === name)?.pct ?? 0} aria-label={`${name} old Core share`} className="input input-sm num w-20" />
                        </td>
                        <td>
                          <input name="newPct" type="number" min={0} max={100} step="0.5" defaultValue={m.newShares[i].pct} aria-label={`${name} new share`} className="input input-sm num w-20" />
                        </td>
                        <td>
                          <input name="role" defaultValue={prof?.role ?? ""} maxLength={120} aria-label={`${name} role`} className="input input-sm w-64" />
                        </td>
                        <td>
                          <textarea name="outcome" rows={3} defaultValue={prof?.outcome ?? ""} maxLength={500} aria-label={`${name} outcome numbers`} className="input input-sm w-80" />
                        </td>
                        <td>
                          <input name="multiplier" type="number" min={0} max={10} step="0.1" defaultValue={prof?.multiplier ?? 1} aria-label={`${name} multiplier`} className="input input-sm num w-20" />
                        </td>
                        <td className="text-center">
                          <input type="radio" name="balancing" value={name} defaultChecked={prof?.balancing} aria-label={`${name} takes the rounding`} />
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row" className="font-medium">
                      Capital
                    </th>
                    <td>
                      <input name="coreCapitalPct" type="number" min={0} max={100} step="0.5" required defaultValue={m.coreSplit.capitalPct} aria-label="Capital old Core share" className="input input-sm num w-20" />
                    </td>
                    <td colSpan={5} className="text-xs text-muted">
                      Old Core split with Capital adds up to 100%. New shares add up to 100% (no Capital line: costs are paid first). The multiplier weights a partner&apos;s accountable load; the rounding partner takes the difference so each tier&apos;s salaries add up to the pool.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Fixed costs per month (the working figure)</legend>
            <div className="flex flex-col gap-2">
              {fixedRows.map((f, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_120px_100px_100px_minmax(0,1fr)]">
                  <input name="fixedLabel" defaultValue={f?.label ?? ""} maxLength={80} placeholder="New cost line" aria-label={`Fixed cost ${i + 1}`} className="input input-sm" />
                  <input name="fixedAmount" type="number" min={0} defaultValue={f?.amount ?? ""} aria-label={`Fixed cost ${i + 1} amount used`} placeholder="Amount" className="input input-sm num" />
                  <input name="fixedLow" type="number" min={0} defaultValue={f?.low ?? ""} aria-label={`Fixed cost ${i + 1} low`} placeholder="Low" className="input input-sm num" />
                  <input name="fixedHigh" type="number" min={0} defaultValue={f?.high ?? ""} aria-label={`Fixed cost ${i + 1} high`} placeholder="High" className="input input-sm num" />
                  <input name="fixedNote" defaultValue={f?.note ?? ""} maxLength={200} aria-label={`Fixed cost ${i + 1} note`} placeholder="Note" className="input input-sm" />
                </div>
              ))}
              <p className="text-xs text-muted">Clear a name to remove a line. Low and high are for reference; the amount is what the reserve and the triggers use.</p>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="mb-2 text-sm font-semibold sm:col-span-4">Partner pay tiers</legend>
            {tierRows.map((pool, i) => (
              <label key={i} className="field">
                Tier {i + 1} pool per month
                <input name="tierPool" type="number" min={1} defaultValue={pool ?? ""} placeholder={pool ? undefined : "Add a tier"} className="input input-sm num" />
              </label>
            ))}
            <label className="field">
              Trigger buffer (×)
              <input name="triggerBuffer" type="number" min={1} max={5} step="0.05" required defaultValue={m.triggerBuffer} className="input input-sm num" />
            </label>
            <label className="field">
              Round triggers to (EGP)
              <input name="triggerRound" type="number" min={1} required defaultValue={m.triggerRound} className="input input-sm num" />
            </label>
            <label className="field">
              Months running to unlock
              <input name="monthsRunning" type="number" min={1} max={12} step={1} required defaultValue={m.monthsRunning} className="input input-sm num" />
            </label>
            <label className="field">
              Base pay (% of X)
              <input name="basePct" type="number" min={0} max={100} step={1} required defaultValue={Math.round(m.baseFraction * 100)} className="input input-sm num" />
            </label>
            <label className="field">
              KPI pay up to (× X)
              <input name="kpiMax" type="number" min={0} max={10} step="0.1" required defaultValue={m.kpiMax} className="input input-sm num" />
            </label>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold sm:col-span-3">For the seat counts</legend>
            <label className="field">
              Full-price seat (EGP)
              <input name="seatPrice" type="number" min={1} required defaultValue={m.seatPrice} className="input input-sm num" />
            </label>
            <label className="field">
              Exocad fee per case file (EGP)
              <input name="exocadFeePerCase" type="number" min={0} required defaultValue={m.exocadFeePerCase} className="input input-sm num" />
            </label>
            <label className="field">
              Agent commission (%)
              <input name="agentCommissionPct" type="number" min={0} max={100} step="0.5" required defaultValue={m.agentCommissionPct} className="input input-sm num" />
            </label>
          </fieldset>
          <div>
            <button className="btn btn-primary">Save the rules</button>
          </div>
        </form>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card title="Camp prices" icon="target">
          <form action={savePricesAction} className="flex flex-col gap-3">
            <input type="hidden" name="back" value="/settings/finance" />
            {prices.map((p) => (
              <fieldset key={p.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-xl border border-line p-3">
                <legend className="sr-only">{p.label}</legend>
                <label className="field col-span-3">
                  Name
                  <input name={`${p.key}_label`} defaultValue={p.label} required maxLength={40} className="input input-sm" />
                </label>
                <label className="field">
                  Price (EGP)
                  <input name={`${p.key}_price`} type="number" min={0} defaultValue={p.price} required className="input input-sm num" />
                </label>
                <label className="field">
                  Payments
                  <input name={`${p.key}_payments`} type="number" min={1} max={24} defaultValue={p.payments} required className="input input-sm num" />
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" name={`${p.key}_offered`} defaultChecked={p.offered} className="check" /> On sale
                </label>
              </fieldset>
            ))}
            <p className="text-xs text-muted">Pre-fills the enrolment form and the offer and pricing tools. The price agreed with each student is kept on their enrolment.</p>
            <div>
              <button className="btn btn-primary btn-sm">Save prices</button>
            </div>
          </form>
        </Card>
        <Card title="Decision rights" icon="shield">
          <form action={saveDecisionRightsAction} className="flex flex-col gap-2">
            <input type="hidden" name="back" value="/settings/finance" />
            {rightsRows.map((d, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input name="decision" defaultValue={d?.decision ?? ""} maxLength={200} placeholder="Decision" aria-label={`Decision ${i + 1}`} className="input input-sm" />
                <input name="who" defaultValue={d?.who ?? ""} maxLength={300} placeholder="Who decides" aria-label={`Who decides ${i + 1}`} className="input input-sm" />
              </div>
            ))}
            <p className="text-xs text-muted">Shown on Team &gt; Functions &amp; owners. Clear both fields to remove a line.</p>
            <div>
              <button className="btn btn-primary btn-sm">Save decision rights</button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="On invoices and receipts" icon="note" className="mt-5 max-w-2xl">
        <p className="mb-4 text-sm text-muted">Who production invoices and payment receipts are from, and how clients pay. Printed at the top and bottom of each.</p>
        <form action={saveInvoiceDetailsAction} className="grid gap-3 sm:grid-cols-2">
          <label className="field sm:col-span-2">
            Business name
            <input name="legalName" required maxLength={120} defaultValue={inv.legalName} dir="auto" className="input" />
          </label>
          <label className="field sm:col-span-2">
            Address
            <input name="address" maxLength={300} defaultValue={inv.address} dir="auto" className="input" />
          </label>
          <label className="field">
            Tax registration number
            <input name="taxId" maxLength={60} defaultValue={inv.taxId} dir="ltr" className="input" />
          </label>
          <label className="field">
            Phone
            <input name="phone" maxLength={40} defaultValue={inv.phone} dir="ltr" className="input" />
          </label>
          <label className="field sm:col-span-2">
            Email
            <input name="email" type="email" maxLength={120} defaultValue={inv.email} dir="ltr" className="input" />
          </label>
          <label className="field sm:col-span-2">
            How to pay (bank, InstaPay, wallet)
            <textarea name="paymentInstructions" rows={3} maxLength={600} defaultValue={inv.paymentInstructions} dir="auto" className="input" />
          </label>
          <label className="field sm:col-span-2">
            Footer note
            <input name="footer" maxLength={300} defaultValue={inv.footer} dir="auto" className="input" />
          </label>
          <div>
            <button className="btn btn-primary">Save invoice details</button>
          </div>
        </form>
      </Card>
    </>
  );
}
