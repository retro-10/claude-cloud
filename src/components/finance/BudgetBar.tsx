import { egp } from "@/lib/cohort-format";

type Budget = { budgetEgp: number | null; spendEgp: number; owedEgp: number; pendingEgp: number; remainingEgp: number | null };

/** A campaign's budget against what is paid, owed and still waiting for approval. */
export function BudgetBar({ c, compact = false }: { c: Budget; compact?: boolean }) {
  if (c.budgetEgp == null) return <span className="text-xs text-muted">No budget set</span>;
  const used = c.spendEgp + c.owedEgp + c.pendingEgp;
  const scale = Math.max(c.budgetEgp, used) || 1;
  const w = (n: number) => `${(n / scale) * 100}%`;
  const over = c.remainingEgp! < 0;
  const pct = c.budgetEgp ? Math.round((used / c.budgetEgp) * 100) : 100;
  return (
    <div>
      <div className="relative flex h-2 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${pct}% of the budget used or committed`}>
        <div className="h-full bg-brand" style={{ width: w(c.spendEgp) }} />
        <div className="h-full bg-brand/50" style={{ width: w(c.owedEgp) }} />
        <div className="h-full bg-warn/60" style={{ width: w(c.pendingEgp) }} />
        {over && <div aria-hidden className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: w(c.budgetEgp) }} />}
      </div>
      {compact ? (
        <div className={`mt-1 text-xs ${over ? "text-danger" : "text-muted"}`}>
          {over ? `${egp(-c.remainingEgp!)} over` : `${egp(c.remainingEgp!)} left`} of {egp(c.budgetEgp)}
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="flex items-center gap-2 text-muted">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand" /> Paid
          </dt>
          <dd className="num text-right">{egp(c.spendEgp)}</dd>
          <dt className="flex items-center gap-2 text-muted">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-brand/50" /> Owed
          </dt>
          <dd className="num text-right">{egp(c.owedEgp)}</dd>
          <dt className="flex items-center gap-2 text-muted">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-warn/60" /> Waiting for approval
          </dt>
          <dd className="num text-right">{egp(c.pendingEgp)}</dd>
          <dt className="font-medium">{over ? "Over budget" : "Left"}</dt>
          <dd className={`num text-right font-semibold ${over ? "text-danger" : "text-ok"}`}>{egp(Math.abs(c.remainingEgp!))}</dd>
        </dl>
      )}
    </div>
  );
}
