import { db } from "@/db";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, PageHeader, Stat } from "@/components/ui";
import { cashForecast } from "@/lib/money";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Cash forecast · Finance" };
const egp = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} EGP`;
const day = (ymd: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

// The next 90 days, week by week: what should come in, what has to go out, and what the budget still plans.
export default async function ForecastPage(props: { searchParams: Promise<{ opening?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("finance:read");
  const raw = (sp.opening ?? "").replace(/[,\s]/g, "");
  const opening = /^-?\d{1,12}$/.test(raw) ? Number(raw) : undefined;
  const f = await cashForecast(db, { opening });
  const low = f.weeks.reduce((m, w) => (w.running < m.running ? w : m), f.weeks[0]);
  const net = f.totals.in - f.totals.out - f.totals.planned;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Cash forecast" subtitle="The next 13 weeks from today: instalments and invoices due in, costs and withdrawals owed out, and the part of each month's budget not booked yet." />
      <FinanceNav />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected in" value={egp(f.totals.in)} icon="trend" hint="instalments and invoices" />
        <Stat label="Owed out" value={egp(f.totals.out)} icon="send" hint="booked costs and withdrawals" />
        <Stat label="Budget not yet booked" value={egp(f.totals.planned)} icon="target" />
        <Stat label={f.hasOpening ? "Lowest point" : "Net over 13 weeks"} value={egp(f.hasOpening ? low.running : net)} icon={f.hasOpening && low.running < 0 ? "alert" : "gauge"} hint={f.hasOpening ? `week of ${day(low.start)}` : undefined} />
      </div>
      {(f.late.in > 0 || f.late.out > 0) && (
        <p role="note" className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
          Not counted below: {egp(f.late.in)} that was due in already and has not arrived, and {egp(f.late.out)} owed out that is past its date. Chase or settle them in the ledger.
        </p>
      )}
      <Card
        title="Week by week"
        icon="calendar"
        bodyClass="p-0"
        actions={
          <form action="/finance/forecast" className="flex items-end gap-2">
            <label className="field">
              <span className="sr-only">Cash on hand today (EGP)</span>
              <input name="opening" defaultValue={opening ?? ""} inputMode="numeric" placeholder="Cash on hand today" className="input input-sm num w-44" />
            </label>
            <button className="btn btn-ghost btn-sm">Show balance</button>
          </form>
        }
      >
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col" className="text-right">In</th>
                <th scope="col" className="text-right">Out (booked)</th>
                <th scope="col" className="text-right">Budget still to spend</th>
                <th scope="col" className="text-right">Net</th>
                <th scope="col" className="text-right">{f.hasOpening ? "Balance" : "Running net"}</th>
              </tr>
            </thead>
            <tbody>
              {f.weeks.map((w) => (
                <tr key={w.start}>
                  <th scope="row" className="font-normal">
                    {day(w.start)}
                  </th>
                  <td className="num text-right">{w.in ? egp(w.in) : "—"}</td>
                  <td className="num text-right">{w.out ? egp(w.out) : "—"}</td>
                  <td className="num text-right text-muted">{w.planned ? egp(w.planned) : "—"}</td>
                  <td className={`num text-right ${w.net < 0 ? "text-danger" : ""}`}>{egp(w.net)}</td>
                  <td className={`num text-right font-medium ${w.running < 0 ? "text-danger" : ""}`}>{egp(w.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Money only moves when it is recorded; this forecast is what the ledger and the budget say today. Enter the cash you hold now to see the balance week by week.
        </p>
      </Card>
    </>
  );
}
