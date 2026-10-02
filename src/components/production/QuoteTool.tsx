"use client";

import { useMemo, useState } from "react";
import { quote } from "@/lib/production-quote";
import { cairoYmd } from "@/lib/time";

type Type = { id: number; name: string; unitPriceEgp: number; standardDays: number; rushDays: number; rushSurchargePct: number };
type Client = { id: number; name: string; discountPct: number };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;
const longDate = (ymd: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));

/** Price and delivery date for a client, before taking the case in: the same rules as intake. */
export function QuoteTool({ types, clients }: { types: Type[]; clients: Client[] }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? 0);
  const [clientId, setClientId] = useState(0);
  const [units, setUnits] = useState(1);
  const [rush, setRush] = useState(false);
  const [received, setReceived] = useState(() => cairoYmd(new Date()));
  const t = types.find((x) => x.id === typeId);
  const discountPct = clients.find((c) => c.id === clientId)?.discountPct ?? 0;
  const q = useMemo(() => (t ? quote({ ...t, units: units || 1, rush, discountPct, receivedYmd: received || cairoYmd(new Date()) }) : null), [t, units, rush, discountPct, received]);
  const message = q && t ? `${t.name} × ${units}${rush ? " (rush)" : ""}: ${egp(q.priceEgp)}, ready by ${longDate(q.dueYmd)} at 18:00.` : "";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          Case type
          <select value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} className="input">
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field sm:col-span-2">
          Client (for their discount)
          <select value={clientId} onChange={(e) => setClientId(Number(e.target.value))} className="input">
            <option value={0}>New client (no discount)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.discountPct ? ` (−${c.discountPct}%)` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Units
          <input type="number" min={1} max={100} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="input num" />
        </label>
        <label className="field">
          Received on
          <input type="date" value={received} onChange={(e) => setReceived(e.target.value)} className="input" />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} /> Rush
        </label>
      </div>
      {q && t && (
        <div className="rounded-xl border border-line bg-raised p-4" aria-live="polite">
          <div className="text-xs text-muted">Price</div>
          <div className="num font-display text-3xl font-semibold">{egp(q.priceEgp)}</div>
          <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted">List ({units} × {egp(t.unitPriceEgp)})</dt>
            <dd className="num text-right">{egp(q.listEgp)}</dd>
            {q.surchargeEgp > 0 && (
              <>
                <dt className="text-muted">Rush +{t.rushSurchargePct}%</dt>
                <dd className="num text-right">+{egp(q.surchargeEgp)}</dd>
              </>
            )}
            {q.discountEgp > 0 && (
              <>
                <dt className="text-muted">Client discount −{discountPct}%</dt>
                <dd className="num text-right">−{egp(q.discountEgp)}</dd>
              </>
            )}
          </dl>
          <div className="mt-4 text-xs text-muted">Ready by</div>
          <div className="font-medium">
            {longDate(q.dueYmd)}, 18:00 <span className="text-sm font-normal text-muted">({q.days} working days; Fridays off)</span>
          </div>
          <label className="field mt-4">
            Message to send
            <textarea readOnly value={message} rows={2} className="input text-sm" />
          </label>
        </div>
      )}
    </div>
  );
}
