import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, Icon, PageHeader, Stat } from "@/components/ui";
import { SECTIONS, shiftMonth, thisMonth } from "@/lib/finance";
import { budgetVsActual } from "@/lib/money";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { copyBudgetAction, saveBudgetAction } from "../actions";

export const metadata = { title: "Budget · Finance" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;
const monthName = (ym: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T12:00:00Z`));

// What we plan to spend each month per cost category, next to what was paid and what is owed.
export default async function BudgetPage(props: { searchParams: Promise<{ month?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const write = can(user.role, "payment:write");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : thisMonth();
  const { rows, totals } = await budgetVsActual(db, month);
  const over = rows.filter((r) => r.over || r.unplanned);
  const spent = totals.paid + totals.owed;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Budget vs actual"
        subtitle="Set what each cost category may spend in a month; see what was paid and what is still owed against it."
        actions={
          <nav aria-label="Month" className="flex items-center gap-1">
            <Link href={`/finance/budget?month=${shiftMonth(month, -1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month">
              <Icon name="chevronLeft" size={14} />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{monthName(month)}</span>
            <Link href={`/finance/budget?month=${shiftMonth(month, 1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Next month">
              <Icon name="chevronRight" size={14} />
            </Link>
          </nav>
        }
      />
      <FinanceNav />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Budget" value={egp(totals.budget)} icon="target" />
        <Stat label="Paid" value={egp(totals.paid)} icon="check" />
        <Stat label="Owed" value={egp(totals.owed)} icon="clock" />
        <Stat label={spent > totals.budget ? "Over budget" : "Left"} value={egp(Math.abs(totals.budget - spent))} icon={spent > totals.budget ? "alert" : "trend"} hint={over.length ? `${over.length} categor${over.length === 1 ? "y" : "ies"} over or unplanned` : "every category within budget"} />
      </div>
      <Card title="By category" icon="list" bodyClass="p-0" actions={write && totals.budget === 0 ? (
        <form action={copyBudgetAction}>
          <input type="hidden" name="month" value={month} />
          <button className="btn btn-ghost btn-sm">Copy last month&apos;s budget</button>
        </form>
      ) : undefined}>
        <form action={saveBudgetAction}>
          <input type="hidden" name="month" value={month} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="text-right">Budget (EGP)</th>
                  <th scope="col" className="text-right">Paid</th>
                  <th scope="col" className="text-right">Owed</th>
                  <th scope="col" className="text-right">Left</th>
                  <th scope="col" className="w-40">Used</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const used = r.budget ? Math.min(1, (r.paid + r.owed) / r.budget) : r.paid + r.owed ? 1 : 0;
                  return (
                    <tr key={`${r.section}|${r.category}`}>
                      <th scope="row" className="font-normal">
                        {r.category}
                        <div className="text-xs text-muted">{SECTIONS[r.section].label}</div>
                      </th>
                      <td className="text-right">
                        {write ? (
                          <input
                            name={`b:${r.section}:${r.category}`}
                            defaultValue={r.budget || ""}
                            inputMode="numeric"
                            aria-label={`Budget for ${r.category}`}
                            className="input input-sm num ml-auto w-28 text-right"
                          />
                        ) : (
                          <span className="num">{r.budget ? egp(r.budget) : "—"}</span>
                        )}
                      </td>
                      <td className="num text-right">{r.paid ? egp(r.paid) : "—"}</td>
                      <td className="num text-right">{r.owed ? egp(r.owed) : "—"}</td>
                      <td className={`num text-right ${r.over || r.unplanned ? "font-medium text-danger" : ""}`}>{r.budget || r.paid || r.owed ? egp(r.left) : "—"}</td>
                      <td>
                        <div className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                          <div className={`h-full ${r.over || r.unplanned ? "bg-danger" : "bg-brand"}`} style={{ width: `${Math.round(used * 100)}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-muted">{r.unplanned ? "no budget" : r.budget ? `${Math.round(((r.paid + r.owed) / r.budget) * 100)}%${r.over ? " · over" : ""}` : ""}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {write && (
            <div className="border-t border-line p-4">
              <button className="btn btn-primary btn-sm">Save the budget</button>
              <span className="ml-3 text-xs text-muted">Empty means no budget for that category. Costs count in the month of their date.</span>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
