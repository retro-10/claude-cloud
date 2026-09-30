import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { PaidBar } from "@/components/finance/CandidateMoney";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, EmptyState, PageHeader, Stat, pretty } from "@/components/ui";
import { egp } from "@/lib/cohort-format";
import { PAYMENT_PLAN_LABEL, STUDENT_STATUS_LABEL, listCandidates } from "@/lib/finance";
import { listCohorts } from "@/lib/cohorts";
import { TIER_LABEL } from "@/lib/pricing";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Candidate balances" };

const SHOW = { all: "Everyone", owing: "Still owing", late: "Overdue", paid: "Paid in full" } as const;

export default async function CandidateBalances(props: { searchParams: Promise<{ batch?: string; show?: string; error?: string; notice?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("finance:read");
  const cohortId = Number(sp.batch) || undefined;
  const show = (sp.show && sp.show in SHOW ? sp.show : "all") as keyof typeof SHOW;
  const [all, batches] = await Promise.all([listCandidates(db, { cohortId }), listCohorts(db)]);
  const now = new Date();
  const late = (c: (typeof all)[number]) => !!c.nextDue && c.nextDue < now;
  const rows = all.filter((c) =>
    show === "owing" ? c.remaining > 0 : show === "late" ? late(c) : show === "paid" ? c.due > 0 && c.remaining === 0 : true,
  );
  const sum = (k: "due" | "paid" | "expected" | "remaining") => all.reduce((a, c) => a + c[k], 0);
  const q = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ batch: sp.batch, show: sp.show, ...p }).filter(([, v]) => v) as [string, string][]).toString();
    return `/finance/candidates${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader eyebrow="Finance" title="Candidate balances" subtitle="What each candidate owes after discount, what arrived, and what is scheduled." />
      <FinanceNav />
      <Flash error={sp.error} notice={sp.notice} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Owed in total" value={egp(sum("due"))} hint={`${all.length} candidates`} icon="leads" />
        <Stat label="Paid" value={egp(sum("paid"))} hint={sum("due") ? `${Math.round((sum("paid") / sum("due")) * 100)}% collected` : undefined} icon="check" tone="brand" />
        <Stat label="Scheduled" value={egp(sum("expected"))} hint="expected installments" icon="calendar" />
        <Stat label="Overdue" value={all.filter(late).length} hint="an installment date has passed" icon="alert" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(SHOW) as (keyof typeof SHOW)[]).map((k) => (
          <Link key={k} href={q({ show: k === "all" ? undefined : k })} aria-current={show === k ? "page" : undefined} className={`btn btn-sm ${show === k ? "btn-secondary border-brand/60" : "btn-ghost"}`}>
            {SHOW[k]}
          </Link>
        ))}
        <form className="ml-auto flex items-center gap-2" action="/finance/candidates">
          {sp.show && <input type="hidden" name="show" value={sp.show} />}
          <label className="sr-only" htmlFor="batch">
            Batch
          </label>
          <select id="batch" name="batch" defaultValue={sp.batch ?? ""} className="input input-sm w-44">
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm">Filter</button>
        </form>
      </div>

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="leads" title="No candidates here">
            Enrolled leads appear here with their plan and balance.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[980px]">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Batch</th>
                  <th>Tier · plan</th>
                  <th>Status</th>
                  <th className="text-right">Due</th>
                  <th className="w-36">Paid</th>
                  <th className="text-right">Remaining</th>
                  <th>Next due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.enrolmentId}>
                    <td>
                      <Link href={`/leads/${c.leadId}#money`} className="font-medium hover:text-accent" dir="auto">
                        {c.fullName}
                      </Link>
                      {c.discountEgp > 0 && <div className="text-xs text-muted">−{egp(c.discountEgp)} discount</div>}
                    </td>
                    <td className="whitespace-nowrap text-muted" dir="auto">
                      {c.cohort}
                    </td>
                    <td className="whitespace-nowrap">
                      {TIER_LABEL[c.tier] ?? c.tier} · <span className={c.paymentPlan === "installments" ? "text-warn" : "text-muted"}>{PAYMENT_PLAN_LABEL[c.paymentPlan]}</span>
                    </td>
                    <td>
                      <span className={`chip ${c.status === "active" ? "chip-ok" : c.status === "dropped" ? "chip-danger" : "chip-brand"}`}>{STUDENT_STATUS_LABEL[c.status]}</span>
                    </td>
                    <td className="num whitespace-nowrap text-right">{egp(c.due)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <PaidBar c={c} />
                        <span className="num whitespace-nowrap text-xs text-muted">{egp(c.paid)}</span>
                      </div>
                    </td>
                    <td className={`num whitespace-nowrap text-right ${c.remaining ? "font-semibold text-warn" : "text-muted"}`}>{egp(c.remaining)}</td>
                    <td className={`num whitespace-nowrap ${late(c) ? "text-danger" : "text-muted"}`}>{c.nextDue ? formatCairo(c.nextDue, false) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
