"use client";

import { useMemo, useState } from "react";
import { pricingScenario, type PricingInput } from "@/lib/tools";

const fmt = (n: number) => `${n < 0 ? "−" : ""}${new Intl.NumberFormat("en-US").format(Math.abs(n))} EGP`;
type Draft = Record<keyof PricingInput, string>;
const toDraft = (p: PricingInput): Draft => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) as Draft;
const num = (s: string) => Number(s.replace(/[,\s]/g, ""));

const FIELDS: [keyof PricingInput, string][] = [
  ["listPriceEgp", "List price (EGP)"],
  ["discountPct", "Average discount (%)"],
  ["seatCap", "Seat cap"],
  ["fillPct", "Seats filled (%)"],
  ["freeSeats", "Free seats"],
  ["fixedCostsEgp", "Batch costs (EGP)"],
  ["variablePerStudentEgp", "Cost per student (EGP)"],
];

function Scenario({ title, d, set }: { title: string; d: Draft; set: (d: Draft) => void }) {
  const r = useMemo(() => pricingScenario(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, num(v)])) as PricingInput), [d]);
  return (
    <section className="card p-4" aria-label={title}>
      <h2 className="mb-3 font-medium">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="field">
            {label}
            <input className="input input-sm num" inputMode="decimal" value={d[k]} onChange={(e) => set({ ...d, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-raised p-3" aria-live="polite">
        {!r.ok ? (
          <p className="text-sm text-danger">{r.error}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted">Seats filled · paying</dt>
            <dd className="num text-right">
              {r.seats} · {r.paying}
            </dd>
            <dt className="text-muted">Price after discount</dt>
            <dd className="num text-right">{fmt(r.netPriceEgp)}</dd>
            <dt className="text-muted">Revenue</dt>
            <dd className="num text-right">{fmt(r.revenueEgp)}</dd>
            <dt className="text-muted">Costs</dt>
            <dd className="num text-right">{fmt(r.costsEgp)}</dd>
            <dt className="font-medium">Margin</dt>
            <dd className={`num text-right font-semibold ${r.marginEgp < 0 ? "text-danger" : ""}`}>
              {fmt(r.marginEgp)}
              {r.marginPct != null ? ` (${Math.round(r.marginPct * 100)}%)` : ""}
            </dd>
            <dt className="text-muted">Break-even</dt>
            <dd className="text-right">{r.breakEvenPaying == null ? "never at this price" : `${r.breakEvenPaying} paying students`}</dd>
            <dt className="text-muted">Margin if every seat fills</dt>
            <dd className="num text-right">{fmt(r.fullMarginEgp)}</dd>
          </dl>
        )}
      </div>
    </section>
  );
}

/** Two versions of a batch side by side: change the price, discount, cap or costs and compare. */
export function PricingTool({ start }: { start: PricingInput }) {
  const [a, setA] = useState(toDraft(start));
  const [b, setB] = useState(toDraft(start));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Scenario title="As it is" d={a} set={setA} />
      <Scenario title="What if" d={b} set={setB} />
    </div>
  );
}
