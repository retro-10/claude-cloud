"use client";

import { useMemo, useState } from "react";
import { saveOfferToLeadAction } from "@/app/(app)/tools/actions";
import { whatsappPrefill } from "@/lib/templates-render";
import { buildOffer, offerMessage, prettyDate, type OfferInput, type Tier } from "@/lib/tools";
import { Icon } from "../ui/Icon";

type Lead = { id: number; fullName: string; phone: string | null; doNotContact: boolean; tier: Tier | null; link: string | null };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const int = (s: string) => (/^\d{1,9}$/.test(s.replace(/[,\s]/g, "")) ? Number(s.replace(/[,\s]/g, "")) : NaN);

/** Pick a tier, discount and plan; see the schedule and a ready message; save it on the lead. */
export function OfferBuilder({ lead, prices, labels, today, canSave }: { lead: Lead | null; prices: Record<Tier, number>; labels: Record<string, string>; today: string; canSave: boolean }) {
  const [tier, setTier] = useState<Tier>(lead?.tier ?? "freelance_ready");
  const [price, setPrice] = useState(String(prices[lead?.tier ?? "freelance_ready"]));
  const [discount, setDiscount] = useState("0");
  const [plan, setPlan] = useState<"one_time" | "installments">("one_time");
  const [deposit, setDeposit] = useState("0");
  const [count, setCount] = useState("2");
  const [firstDue, setFirstDue] = useState(today);
  const [link, setLink] = useState(lead?.link ?? "");
  const [decision, setDecision] = useState("");
  const [copied, setCopied] = useState(false);

  const input: OfferInput = { tier, priceEgp: int(price), discountEgp: int(discount || "0"), plan, depositEgp: int(deposit || "0"), instalments: int(count), firstDue };
  const result = useMemo(() => buildOffer(input), [tier, price, discount, plan, deposit, count, firstDue]); // eslint-disable-line react-hooks/exhaustive-deps
  const message = result.ok ? offerMessage(input, result, { firstName: lead?.fullName.split(/\s+/)[0], tierLabel: labels[tier], paymentLink: link.trim() || undefined, decisionBy: decision || undefined }) : "";
  const wa = lead && !lead.doNotContact ? whatsappPrefill(lead.phone, message) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field sm:col-span-2">
            Programme
            <select
              className="input"
              value={tier}
              onChange={(e) => {
                const t = e.target.value as Tier;
                setTier(t);
                setPrice(String(prices[t]));
              }}
            >
              {(Object.keys(prices) as Tier[]).map((t) => (
                <option key={t} value={t}>
                  {labels[t]} · list {fmt(prices[t])} EGP
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Price (EGP)
            <input className="input num" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            Discount (EGP)
            <input className="input num" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Payment</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="plan" checked={plan === "one_time"} onChange={() => setPlan("one_time")} /> In full
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="plan" checked={plan === "installments"} onChange={() => setPlan("installments")} /> Instalments
              </label>
            </div>
          </fieldset>
          {plan === "installments" && (
            <>
              <label className="field">
                Deposit now (EGP)
                <input className="input num" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              </label>
              <label className="field">
                Instalments after it
                <select className="input" value={count} onChange={(e) => setCount(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}, monthly
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                First instalment
                <input type="date" className="input" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
              </label>
            </>
          )}
          <label className="field sm:col-span-2">
            Payment link (optional)
            <input className="input" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
          </label>
          <label className="field">
            Decision by (optional)
            <input type="date" className="input" value={decision} onChange={(e) => setDecision(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="card p-4" aria-live="polite">
          {!result.ok ? (
            <p role="alert" className="text-sm text-danger">
              {result.error}
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Total</span>
                <span className="num font-display text-[26px] font-semibold">{fmt(result.total)} EGP</span>
              </div>
              <table className="table mt-3">
                <caption className="sr-only">Payment schedule</caption>
                <thead>
                  <tr>
                    <th scope="col">Payment</th>
                    <th scope="col">Due</th>
                    <th scope="col" className="text-right">
                      EGP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((s) => (
                    <tr key={s.label}>
                      <td>{s.label}</td>
                      <td>{s.due ? prettyDate(s.due) : "On enrolment"}</td>
                      <td className="num text-right">{fmt(s.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {result.ok && (
          <div className="card p-4">
            <label className="field">
              Message
              <textarea className="input" rows={8} readOnly value={message} dir="auto" />
            </label>
            <p className="mt-2 text-xs text-muted">Factual on purpose: no deadlines, incentives or outcome promises unless Badr has approved them.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(message);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Icon name="copy" size={14} /> {copied ? "Copied" : "Copy message"}
              </button>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="btn btn-wa btn-sm">
                  <Icon name="chat" size={14} /> Open in WhatsApp
                </a>
              )}
              {lead && canSave && (
                <form action={saveOfferToLeadAction}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="tier" value={tier} />
                  <input type="hidden" name="amount" value={result.total} />
                  <input type="hidden" name="link" value={link} />
                  <input type="hidden" name="decision" value={decision} />
                  <button className="btn btn-primary btn-sm">
                    <Icon name="check" size={14} /> Save offer on {lead.fullName.split(/\s+/)[0]}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
