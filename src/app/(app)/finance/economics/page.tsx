import Link from "next/link";
import { db } from "@/db";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, EmptyState, PageHeader, Stat, Tabs } from "@/components/ui";
import { unitEconomics } from "@/lib/money";
import { requirePageCan } from "@/lib/server-auth";
import { startOfCairoDay } from "@/lib/time";

export const metadata = { title: "Unit economics · Finance" };
const egp = (n: number | null) => (n == null ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} EGP`);
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const PERIODS = { "30": "30 days", "90": "90 days", "365": "12 months" } as const;

// What a lead, a student, a batch and a production case are worth, and what they cost.
export default async function EconomicsPage(props: { searchParams: Promise<{ days?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("finance:read");
  const days = (sp.days && sp.days in PERIODS ? sp.days : "90") as keyof typeof PERIODS;
  const to = new Date();
  const from = startOfCairoDay(new Date(to.getTime() - Number(days) * 86_400_000));
  const u = await unitEconomics(db, { from, to });

  return (
    <>
      <PageHeader eyebrow="Finance" title="Unit economics" subtitle="Cost per lead and per enrolment, each batch's margin, and each kind of production case's margin." />
      <FinanceNav />
      <Tabs label="Period" current={`/finance/economics?days=${days}`} items={Object.entries(PERIODS).map(([k, v]) => ({ href: `/finance/economics?days=${k}`, label: v }))} />
      <h2 className="mb-3 text-sm font-medium text-muted">Marketing, last {PERIODS[days]}</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Marketing spend" value={egp(u.marketing.spend)} icon="target" hint={`${u.marketing.leads} leads · ${u.marketing.enrolments} enrolments`} />
        <Stat label="Cost per lead" value={egp(u.marketing.costPerLead)} icon="leads" />
        <Stat label="Cost per enrolment" value={egp(u.marketing.costPerEnrolment)} icon="check" />
        <Stat label="Revenue per enrolment" value={egp(u.marketing.revenuePerEnrolment)} icon="trend" hint="after discount, free seats as 0" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Batches" icon="cohorts" bodyClass="p-0">
          {!u.perBatch.length ? (
            <EmptyState icon="cohorts" title="No batches with students or costs yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Batch</th>
                    <th scope="col" className="text-right">Students</th>
                    <th scope="col" className="text-right">Revenue</th>
                    <th scope="col" className="text-right">Costs</th>
                    <th scope="col" className="text-right">Margin</th>
                    <th scope="col" className="text-right">Per student</th>
                  </tr>
                </thead>
                <tbody>
                  {u.perBatch.map((b) => (
                    <tr key={b.id}>
                      <th scope="row" className="font-normal">
                        <Link href={`/cohorts/${b.id}`} className="link">
                          {b.name}
                        </Link>
                        <div className="text-xs text-muted">{egp(b.received)} received</div>
                      </th>
                      <td className="num text-right">
                        {b.students}/{b.seatCap}
                      </td>
                      <td className="num text-right">{egp(b.revenue)}</td>
                      <td className="num text-right">{egp(b.costs)}</td>
                      <td className={`num text-right ${b.margin < 0 ? "text-danger" : ""}`}>
                        {egp(b.margin)}
                        <div className="text-xs text-muted">{pct(b.marginPct)}</div>
                      </td>
                      <td className="num text-right">{egp(b.perStudent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-3 text-xs text-muted">Costs are the ledger costs tagged to the batch (choose the batch when you record a cost). Revenue is what its students owe after discount.</p>
        </Card>
        <Card title={`Production, delivered in the last ${PERIODS[days]}`} icon="layers" bodyClass="p-0">
          {!u.perCaseType.length ? (
            <EmptyState icon="layers" title="No cases delivered in this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Case type</th>
                    <th scope="col" className="text-right">Cases</th>
                    <th scope="col" className="text-right">Revenue</th>
                    <th scope="col" className="text-right">Designer pay</th>
                    <th scope="col" className="text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {u.perCaseType.map((t) => (
                    <tr key={t.type}>
                      <th scope="row" className="font-normal">
                        {t.type}
                        <div className="text-xs text-muted">avg. {egp(t.avgPrice)} a case</div>
                      </th>
                      <td className="num text-right">{t.cases}</td>
                      <td className="num text-right">{egp(t.revenue)}</td>
                      <td className="num text-right">{egp(t.pay)}</td>
                      <td className="num text-right">
                        {egp(t.margin)}
                        <div className="text-xs text-muted">{pct(t.marginPct)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
