import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { DEFAULTS, getSettings } from "@/lib/app-settings";
import { requirePageCan } from "@/lib/server-auth";
import { saveInvoiceDetailsAction, saveSplitAction } from "../../finance/actions";

export const metadata = { title: "Finance split · Settings" };

export default async function FinanceSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const { financeSplit: split, invoiceDetails: inv } = await getSettings(db);
  const rows = [...split.partners, ...Array(Math.max(0, 6 - split.partners.length)).fill(null)] as ({ name: string; pct: number } | null)[];
  const def = DEFAULTS.financeSplit;

  return (
    <>
      <Flash {...sp} />
      <Card title="How net income is split" icon="trend" className="max-w-2xl">
        <p className="mb-4 text-sm text-muted">
          Net income (received payments and client work, minus refunds) is shared by these percentages. Costs are paid out of Capital, and a partner withdrawal is an
          advance on that partner’s share. All percentages together must add up to 100. Default: {def.partners.map((p) => `${p.name} ${p.pct}`).join(" · ")} · Capital {def.capitalPct}.
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
