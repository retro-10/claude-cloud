"use client";

import { useMemo, useState } from "react";
import { campaignRoi } from "@/lib/tools";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const pct = (x: number) => String(Math.round(x * 1000) / 10);

/** Before spending: what a budget should bring at your rates, and the most a lead may cost. */
export function RoiCalculator({ d }: { d: { costPerLead: number | null; leadToConsult: number; consultToEnrol: number; avgPriceEgp: number; fromData: boolean } }) {
  const [spend, setSpend] = useState("20000");
  const [cpl, setCpl] = useState(String(d.costPerLead ?? 150));
  const [l2c, setL2c] = useState(pct(d.leadToConsult));
  const [c2e, setC2e] = useState(pct(d.consultToEnrol));
  const [price, setPrice] = useState(String(d.avgPriceEgp));
  const num = (s: string) => Number(s.replace(/[,\s]/g, ""));
  const r = useMemo(
    () => campaignRoi({ spendEgp: num(spend), costPerLead: num(cpl), leadToConsult: num(l2c) / 100, consultToEnrol: num(c2e) / 100, avgPriceEgp: num(price) }),
    [spend, cpl, l2c, c2e, price],
  );
  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="field">
      {label}
      <input className="input num" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        {field("Spend (EGP)", spend, setSpend)}
        {field("Cost per lead (EGP)", cpl, setCpl)}
        {field("Leads that hold a consult (%)", l2c, setL2c)}
        {field("Consults that enrol (%)", c2e, setC2e)}
        <div className="sm:col-span-2">{field("Average price per seat (EGP)", price, setPrice)}</div>
        <p className="text-xs text-muted sm:col-span-2">
          {d.fromData ? "Rates and price start from the last 180 days." : "Rates start from cautious placeholders until there is more history."}
          {d.costPerLead ? " Cost per lead starts from your campaigns' actual average." : ""}
        </p>
      </div>
      <div className="card p-4" aria-live="polite">
        {!r.ok ? (
          <p role="alert" className="text-sm text-danger">
            {r.error}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              {[
                ["Leads", fmt(r.leads)],
                ["Consults", fmt(r.consults)],
                ["Enrolments", fmt(r.enrolments)],
              ].map(([k, v]) => (
                <div key={k} className="well p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="num font-display text-[22px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="well p-3">
                <dt className="text-xs text-muted">Revenue</dt>
                <dd className="num font-semibold">{fmt(r.revenueEgp)} EGP</dd>
              </div>
              <div className="well p-3">
                <dt className="text-xs text-muted">Return on spend</dt>
                <dd className={`num font-semibold ${r.roi < 0 ? "text-danger" : "text-ok"}`}>{`${r.roi >= 0 ? "+" : ""}${Math.round(r.roi * 100)}%`}</dd>
              </div>
              <div className="well p-3">
                <dt className="text-xs text-muted">Cost per enrolment</dt>
                <dd className="num font-semibold">{r.costPerEnrolment ? `${fmt(r.costPerEnrolment)} EGP` : "no enrolment at this spend"}</dd>
              </div>
              <div className="well p-3">
                <dt className="text-xs text-muted">Break-even cost per lead</dt>
                <dd className="num font-semibold">{fmt(r.breakEvenCostPerLead)} EGP</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">Pay more than the break-even per lead and the campaign loses money at these rates. Whole people only: fractions are rounded down.</p>
          </>
        )}
      </div>
    </div>
  );
}
