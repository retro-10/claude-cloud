import Link from "next/link";
import { db } from "@/db";
import { PairColumns, BarList } from "@/components/charts";
import { Flash } from "@/components/Flash";
import { AddEntry } from "@/components/finance/AddEntry";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, EmptyState, Icon, PageHeader, Stat } from "@/components/ui";
import { egp } from "@/lib/cohort-format";
import { SECTIONS, STATUS_LABEL, financeBoard, listCandidates, shiftMonth, thisMonth } from "@/lib/finance";
import { listTeam } from "@/lib/programme";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { settleEntryAction } from "./actions";

export const metadata = { title: "Finance" };

const money = (n: number) => egp(Math.round(n));
const monthName = (ym: string, style: "long" | "short" = "long") =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (!before && !now) return <span>—</span>;
  if (!before) return <span>new this month</span>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  return (
    <span className={good ? "text-ok" : "text-warn"}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% <span className="text-muted">vs last month</span>
    </span>
  );
}

export default async function FinancePage(props: { searchParams: Promise<{ month?: string; error?: string; notice?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : thisMonth();
  const [b, candidates, team] = await Promise.all([financeBoard(db, month), listCandidates(db), listTeam(db)]);
  const m = b.month_;
  const prev = b.series[b.series.length - 2] ?? { income: 0, costs: 0, net: 0 };
  const cur = b.series[b.series.length - 1];
  const write = can(user.role, "payment:write");
  const here = `/finance?month=${month}`;
  const partners = b.split.partners.map((p) => p.name);
  const opts = candidates.map((c) => ({ id: c.enrolmentId, name: `${c.fullName}${c.cohort ? ` · ${c.cohort}` : ""}` }));
  const now = new Date();
  const isNow = month === thisMonth();
  const collectedPct = b.candidates.due ? Math.round((b.candidates.paid / b.candidates.due) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="The books"
        subtitle={`Net income is split ${b.split.partners.map((p) => `${p.name} ${p.pct}%`).join(" · ")} · Capital ${b.split.capitalPct}%. Costs come out of Capital.`}
        actions={
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Month">
            <Link href={`/finance?month=${shiftMonth(month, -1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month">
              <Icon name="chevronLeft" size={14} />
            </Link>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthName(month)}</span>
            <Link href={`/finance?month=${shiftMonth(month, 1)}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Next month">
              <Icon name="chevronRight" size={14} />
            </Link>
            {!isNow && (
              <Link href="/finance" className="btn btn-ghost btn-sm">
                Today
              </Link>
            )}
          </div>
        }
      />
      <FinanceNav />
      <Flash error={sp.error} notice={sp.notice} />

      {write && (
        <div className="mb-5 flex flex-wrap gap-2">
          <AddEntry label="Payment" back={here} partners={partners} candidates={opts} variant="btn btn-primary btn-sm" initial={{ section: "income", category: "Candidate payment" }} />
          <AddEntry label="Client work" back={here} partners={partners} candidates={opts} variant="btn btn-secondary btn-sm" initial={{ section: "income", category: "OrlaDent client work" }} />
          <AddEntry label="Expense" back={here} partners={partners} candidates={opts} team={team} variant="btn btn-secondary btn-sm" initial={{ section: "variable_costs", category: "Freelancers & sales" }} />
          <AddEntry label="Withdrawal" back={here} partners={partners} candidates={opts} variant="btn btn-secondary btn-sm" initial={{ section: "partner_withdrawals", category: "Partner withdrawal" }} />
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Received" value={money(m.income)} icon="trend" hint={<Delta now={cur.income} before={prev.income} />} />
        <Stat
          label="Costs paid"
          value={money(m.costs)}
          icon="layers"
          hint={
            <>
              {money(m.fixedCosts)} fixed · {money(m.variableCosts)} variable
            </>
          }
        />
        <Stat label="Net to split" value={money(m.net)} icon="gauge" tone="brand" hint={m.refunds ? `after ${money(m.refunds)} in refunds` : <Delta now={cur.income} before={prev.income} />} />
        <Stat
          label="Capital left"
          value={<span className={b.capitalBalance < 0 ? "text-danger" : ""}>{money(b.capitalBalance)}</span>}
          icon="shield"
          hint={`${money(m.capitalShare)} in this month · ${money(m.costs)} out`}
        />
      </div>

      <section aria-labelledby="shares" className="mb-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="shares" className="font-display text-lg font-semibold">
            Partner shares
          </h2>
          <span className="text-xs text-muted">Withdrawals are advances on the partner’s share. Balance = all shares to date − all withdrawals.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {b.balances.map((p) => {
            const month_ = m.shares.find((s) => s.name === p.name);
            const pctOf = p.share > 0 ? Math.min(100, Math.round((p.withdrawn / p.share) * 100)) : p.withdrawn ? 100 : 0;
            return (
              <div key={p.name} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="chip chip-brand">{month_?.pct ?? 0}%</span>
                </div>
                <div className="num mt-3 font-display text-2xl font-semibold">{money(month_?.share ?? 0)}</div>
                <div className="text-xs text-muted">share of {monthName(month, "short")}</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${pctOf}% of the share withdrawn`}>
                  <div className={`h-full rounded-full ${p.balance < 0 ? "bg-danger" : "bg-brand"}`} style={{ width: `${pctOf}%` }} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
                  <dt className="text-muted">Withdrawn</dt>
                  <dd className="num text-right">{money(p.withdrawn)}</dd>
                  <dt className="text-muted">Balance</dt>
                  <dd className={`num text-right font-semibold ${p.balance < 0 ? "text-danger" : "text-ok"}`}>{money(p.balance)}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Last 12 months" icon="trend" className="xl:col-span-2">
          <PairColumns
            a="Received"
            b="Costs"
            unit=" EGP"
            data={b.series.map((s) => ({ x: monthName(s.month, "short").slice(0, 3), label: monthName(s.month), a: s.income, b: s.costs }))}
          />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted hover:text-fg">Show as a table</summary>
            <table className="table mt-2">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Costs</th>
                  <th className="text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {b.series.map((s) => (
                  <tr key={s.month}>
                    <td>{monthName(s.month)}</td>
                    <td className="num text-right">{money(s.income)}</td>
                    <td className="num text-right">{money(s.costs)}</td>
                    <td className={`num text-right ${s.net < 0 ? "text-danger" : ""}`}>{money(s.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
        <Card title={`Where it went · ${monthName(month, "short")}`} icon="layers">
          {m.byCategory.length === 0 ? (
            <EmptyState icon="trend" title="Nothing recorded this month" />
          ) : (
            <BarList
              unit=" EGP"
              rows={m.byCategory.map((c) => ({ label: c.category, value: c.amount, note: SECTIONS[c.section].label, muted: c.section !== "income" }))}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          title={`Coming up (${b.comingUp.length})`}
          icon="calendar"
          className="xl:col-span-2"
          bodyClass="p-0"
          actions={
            <Link href="/finance/ledger?status=expected" className="text-xs text-muted hover:text-fg">
              Open ledger
            </Link>
          }
        >
          {b.comingUp.length === 0 ? (
            <EmptyState icon="check" title="Nothing expected or owed">
              Expected installments and unpaid bills show here until they are marked done.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {b.comingUp.slice(0, 12).map((e) => {
                const when = e.date ?? e.createdAt;
                const late = e.date && e.date < now;
                const income = e.section === "income";
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${income ? "border-brand/40 text-accent" : "border-line text-muted"}`}>
                      <Icon name={income ? "arrowRight" : "arrowUpRight"} size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium" dir="auto">
                        {e.entry}
                      </div>
                      <div className="text-xs text-muted">
                        {e.candidate ?? e.fromTo ?? e.category} · <span className={late ? "text-warn" : ""}>{late ? "was due " : "due "}{formatCairo(when, false)}</span>
                      </div>
                    </div>
                    <span className={`num whitespace-nowrap text-sm font-semibold ${income ? "" : "text-muted"}`}>
                      {income ? "+" : "−"}
                      {money(e.amountEgp)}
                    </span>
                    {write && (
                      <form action={settleEntryAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="back" value={here} />
                        <button className="btn btn-secondary btn-sm" title={`Mark as ${income ? "received" : "paid"}`}>
                          <Icon name="check" size={14} /> {income ? STATUS_LABEL.received : STATUS_LABEL.paid}
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Candidates"
          icon="leads"
          actions={
            <Link href="/finance/candidates" className="text-xs text-muted hover:text-fg">
              All balances
            </Link>
          }
        >
          <div className="num font-display text-3xl font-semibold">{collectedPct}%</div>
          <div className="text-xs text-muted">
            collected of {money(b.candidates.due)} owed by {b.candidates.count} candidates
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${collectedPct}% collected`}>
            <div className="h-full bg-brand" style={{ width: `${b.candidates.due ? (b.candidates.paid / b.candidates.due) * 100 : 0}%` }} />
            <div className="h-full bg-brand/35" style={{ width: `${b.candidates.due ? (b.candidates.expected / b.candidates.due) * 100 : 0}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="flex items-center gap-2 text-muted">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand" /> Paid
            </dt>
            <dd className="num text-right">{money(b.candidates.paid)}</dd>
            <dt className="flex items-center gap-2 text-muted">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand/35" /> Expected
            </dt>
            <dd className="num text-right">{money(b.candidates.expected)}</dd>
            <dt className="text-muted">Not scheduled yet</dt>
            <dd className="num text-right text-warn">{money(Math.max(0, b.candidates.remaining - b.candidates.expected))}</dd>
          </dl>
          <hr className="my-4 border-line" />
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">All-time received</dt>
            <dd className="num text-right">{money(b.allTime.income)}</dd>
            <dt className="text-muted">All-time costs</dt>
            <dd className="num text-right">{money(b.allTime.costs)}</dd>
          </dl>
        </Card>
      </div>
    </>
  );
}
