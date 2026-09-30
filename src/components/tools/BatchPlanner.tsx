"use client";

import { useMemo, useState } from "react";
import type { PlannerDefaults } from "@/lib/tools-data";
import { planBatch } from "@/lib/tools";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const pct = (x: number) => String(Math.round(x * 1000) / 10);
const timeLeft = (weeks: number) => {
  const days = Math.round(weeks * 7);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const w = Math.round(weeks * 10) / 10;
  return `${w} weeks`;
};

/** Seats to fill → consults → leads, per week until enrolment closes, at your own conversion rates. */
export function BatchPlanner({ d, today }: { d: PlannerDefaults; today: string }) {
  const first = d.batches[0];
  const [batchId, setBatchId] = useState(first ? String(first.id) : "");
  const [seats, setSeats] = useState(first ? String(Math.max(0, first.seatCap - first.enrolled)) : "20");
  const [close, setClose] = useState(first?.closeYmd ?? "");
  const [price, setPrice] = useState(String(d.avgPriceEgp));
  const [l2c, setL2c] = useState(pct(d.leadToConsult));
  const [c2e, setC2e] = useState(pct(d.consultToEnrol));

  const weeks = close ? (Date.parse(`${close}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000) : NaN;
  const r = useMemo(
    () => planBatch({ seatsToFill: Number(seats), avgPriceEgp: Number(price) || 0, leadToConsult: Number(l2c) / 100, consultToEnrol: Number(c2e) / 100, weeksLeft: weeks }),
    [seats, price, l2c, c2e, weeks],
  );

  const pick = (id: string) => {
    setBatchId(id);
    const b = d.batches.find((x) => String(x.id) === id);
    if (b) {
      setSeats(String(Math.max(0, b.seatCap - b.enrolled)));
      setClose(b.closeYmd ?? "");
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {d.batches.length > 0 && (
            <label className="field sm:col-span-2">
              Batch
              <select className="input" value={batchId} onChange={(e) => pick(e.target.value)}>
                {d.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.enrolled} of {b.seatCap} seats taken
                  </option>
                ))}
                <option value="">Another batch (type the numbers)</option>
              </select>
            </label>
          )}
          <label className="field">
            Seats to fill
            <input className="input num" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          </label>
          <label className="field">
            Enrolment closes
            <input type="date" className="input" value={close} onChange={(e) => setClose(e.target.value)} />
          </label>
          <label className="field">
            Leads that hold a consult (%)
            <input className="input num" inputMode="decimal" value={l2c} onChange={(e) => setL2c(e.target.value)} />
          </label>
          <label className="field">
            Consults that enrol (%)
            <input className="input num" inputMode="decimal" value={c2e} onChange={(e) => setC2e(e.target.value)} />
          </label>
          <label className="field sm:col-span-2">
            Average price per seat (EGP)
            <input className="input num" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          {d.fromData
            ? `Rates and price start from the last 180 days: ${fmt(d.sample.leads)} leads, ${fmt(d.sample.consulted)} held a consult, ${fmt(d.sample.enrolled)} enrolled.`
            : `Not enough history yet (${fmt(d.sample.leads)} leads in 180 days), so the rates start from cautious placeholders. Change them to what you expect.`}
        </p>
      </div>

      <div className="card p-4" aria-live="polite">
        {!r.ok ? (
          <p role="alert" className="text-sm text-danger">
            {r.error}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              To fill {fmt(Number(seats))} seat{Number(seats) === 1 ? "" : "s"} in {timeLeft(weeks)} you need about:
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div className="well p-3">
                <dt className="text-xs text-muted">New leads</dt>
                <dd className="num font-display text-[26px] font-semibold">{fmt(r.leads)}</dd>
                <dd className="text-xs text-muted">{fmt(r.leadsPerWeek)} a week</dd>
              </div>
              <div className="well p-3">
                <dt className="text-xs text-muted">Consults held</dt>
                <dd className="num font-display text-[26px] font-semibold">{fmt(r.consults)}</dd>
                <dd className="text-xs text-muted">{fmt(r.consultsPerWeek)} a week</dd>
              </div>
              <div className="well col-span-2 p-3">
                <dt className="text-xs text-muted">Revenue if every seat fills at that price</dt>
                <dd className="num font-display text-[26px] font-semibold">{fmt(r.revenueEgp)} EGP</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">Tip: set the quarter&rsquo;s lead and consult targets from these numbers in Settings &gt; Targets.</p>
          </>
        )}
      </div>
    </div>
  );
}
