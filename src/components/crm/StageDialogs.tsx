"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { enrolAction, moveLead } from "@/app/(app)/pipeline/actions";
import type { Missing } from "@/lib/exit-criteria";
import { LIST_PRICE_EGP } from "@/lib/pricing";
import { Icon } from "../ui/Icon";

export type StageLite = { key: string; label: string; kind: "open" | "won" | "lost" | "nurture" };
export type CohortLite = { id: number; name: string; seatCap: number; used: number };
export type LeadLite = { id: number; fullName: string; tierInterest: string; hasNextStep: boolean; offerTier?: string | null; offerAmountEgp?: number | null };

const TIERS = ["foundation", "freelance_ready", "production_partner"] as const;
const pretty = (s: string) => s.replace(/_/g, " ");

export function Modal({ title, icon = "arrowRight", children, onCancel, wide }: { title: string; icon?: Parameters<typeof Icon>[0]["name"]; children: React.ReactNode; onCancel: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLElement>("select, input, textarea, button[data-autofocus]")?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-3 pt-[8vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={onCancel}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`relative w-full ${wide ? "max-w-lg" : "max-w-md"} overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in`}
      >
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/40 bg-gold/10 text-accent">
            <Icon name={icon} />
          </span>
          <h2 className="flex-1 font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-icon" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** The unmet exit criteria, each with what to do about it. */
export function MissingList({ missing }: { missing: Missing[] }) {
  return (
    <div role="alert" className="rounded-xl border border-warn/40 bg-warn/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
        <Icon name="flag" size={15} /> Not ready for this stage yet
      </p>
      <ul className="flex flex-col gap-2">
        {missing.map((m) => (
          <li key={m.key} className="flex gap-2 text-sm">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-warn/60 text-warn">
              <Icon name="x" size={10} />
            </span>
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-xs text-muted">{m.fix}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Override({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field mt-3">
      Owner override: why move anyway? (saved in the audit log)
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="input" placeholder="e.g. Paid in cash at the office, reference to follow" />
    </label>
  );
}

/**
 * Moving a lead to any stage except Enrolled. Asks for what the move needs (lost reason, next step)
 * and, when exit criteria are missing, lists them; owners may override with a reason.
 */
export function MoveDialog(props: {
  lead: LeadLite;
  to: StageLite;
  lostReasons: { id: number; label: string; kind?: string }[];
  initialMissing?: Missing[];
  canOverride?: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { lead, to } = props;
  const [reason, setReason] = useState("");
  const [next, setNext] = useState("");
  const [missing, setMissing] = useState<Missing[]>(props.initialMissing ?? []);
  const [canOverride, setCanOverride] = useState(props.canOverride ?? false);
  const [override, setOverride] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  const needsNext = (to.kind === "open" || to.kind === "nurture") && !lead.hasNextStep;

  const submit = (force: boolean) => {
    setError("");
    if (to.kind === "lost" && !reason) return setError("Pick a lost reason.");
    start(async () => {
      const r = await moveLead({
        leadId: lead.id,
        stage: to.key,
        lostReasonId: reason ? Number(reason) : null,
        nextStepDate: next || null,
        override: force ? override : null,
      });
      if (r.ok) return props.onDone();
      if (r.missing?.length) {
        setMissing(r.missing);
        setCanOverride(!!r.canOverride);
      } else setError(r.error);
    });
  };

  return (
    <Modal title={to.kind === "lost" ? "Mark as lost" : `Move to ${to.label}`} icon={to.kind === "lost" ? "x" : "arrowRight"} onCancel={props.onCancel}>
      <p className="mb-4 text-sm text-muted">
        <span dir="auto" className="font-medium text-fg">
          {lead.fullName}
        </span>{" "}
        → {to.label}
      </p>
      <div className="flex flex-col gap-4">
        {to.kind === "lost" && (
          <label className="field">
            Lost reason (required)
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose…</option>
              {props.lostReasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                  {r.kind === "no_decision" ? " (went silent after the offer)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsNext && (
          <label className="field">
            Next step on {to.kind === "nurture" ? "(required)" : "(every open lead needs one)"}
            <input type="date" className="input" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
        )}
        {missing.length > 0 && <MissingList missing={missing} />}
        {missing.length > 0 && canOverride && <Override value={override} onChange={setOverride} />}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={props.onCancel} className="btn btn-ghost">
          Cancel
        </button>
        {missing.length > 0 && canOverride ? (
          <button type="button" disabled={busy || !override.trim()} onClick={() => submit(true)} className="btn btn-danger">
            Move anyway
          </button>
        ) : null}
        <button type="button" data-autofocus disabled={busy} onClick={() => submit(false)} className="btn btn-primary">
          {busy ? "Saving…" : to.kind === "lost" ? "Mark lost" : "Move"}
        </button>
      </div>
    </Modal>
  );
}

export function EnrolDialog(props: { lead: LeadLite; cohorts: CohortLite[]; isOwner: boolean; onCancel: () => void; onDone: () => void }) {
  const start0 = (TIERS as readonly string[]).includes(props.lead.offerTier ?? "")
    ? (props.lead.offerTier as (typeof TIERS)[number])
    : (TIERS as readonly string[]).includes(props.lead.tierInterest)
      ? (props.lead.tierInterest as (typeof TIERS)[number])
      : "foundation";
  const [tier, setTier] = useState<(typeof TIERS)[number]>(start0);
  const [amount, setAmount] = useState(String(props.lead.offerAmountEgp ?? LIST_PRICE_EGP[start0] ?? ""));
  const [cohortId, setCohortId] = useState(String(props.cohorts[0]?.id ?? ""));
  const [paidOn, setPaidOn] = useState("");
  const [ref, setRef] = useState("");
  const [gateway, setGateway] = useState<"paymob" | "other">("paymob");
  const [override, setOverride] = useState(false);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [canOverrideCriteria, setCanOverrideCriteria] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const [busy, start] = useTransition();

  const cohort = props.cohorts.find((c) => String(c.id) === cohortId);
  const isFull = cohort ? cohort.used >= cohort.seatCap : false;

  const submit = (force: boolean) =>
    start(async () => {
      setError("");
      const r = await enrolAction({
        leadId: props.lead.id,
        cohortId: Number(cohortId),
        tier,
        amountEgp: Number(amount),
        paidOn: paidOn || null,
        paymentRef: ref || null,
        gateway,
        overrideCap: override,
        overrideCriteria: force ? why : null,
      });
      if (r.ok) return props.onDone();
      if (r.missing?.length) {
        setMissing(r.missing);
        setCanOverrideCriteria(!!r.canOverride);
      }
      setError(r.error);
      if (r.cohortFull) setFull(true);
    });

  return (
    <Modal title="Enrol student" icon="cohorts" onCancel={props.onCancel} wide>
      <p className="mb-4 text-sm font-medium" dir="auto">
        {props.lead.fullName}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="field col-span-2">
          Cohort
          <select className="input" value={cohortId} onChange={(e) => { setCohortId(e.target.value); setFull(false); setOverride(false); }}>
            {props.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.used}/{c.seatCap} seats)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Tier
          <select
            className="input"
            value={tier}
            onChange={(e) => {
              const t = e.target.value as (typeof TIERS)[number];
              setTier(t);
              setAmount(String(LIST_PRICE_EGP[t] ?? "")); // Production Partner is custom: blank
            }}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {pretty(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Amount (EGP)
          <input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder={tier === "production_partner" ? "Custom price" : ""} />
        </label>
        <label className="field">
          Payment reference
          <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" placeholder="Paymob transaction id" />
        </label>
        <label className="field">
          Gateway
          <select className="input" value={gateway} onChange={(e) => setGateway(e.target.value as "paymob" | "other")}>
            <option value="paymob">paymob</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="field col-span-2">
          Paid on (optional)
          <input type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {(isFull || full) && props.isOwner && (
          <label className="flex items-center gap-2 text-sm text-warn">
            <input type="checkbox" className="check" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Cohort is full: override the seat cap
          </label>
        )}
        {missing.length > 0 && <MissingList missing={missing} />}
        {missing.length > 0 && canOverrideCriteria && <Override value={why} onChange={setWhy} />}
        {error && !missing.length && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={props.onCancel} className="btn btn-ghost">
          Cancel
        </button>
        {missing.length > 0 && canOverrideCriteria && (
          <button type="button" disabled={busy || !why.trim()} onClick={() => submit(true)} className="btn btn-danger">
            Enrol anyway
          </button>
        )}
        <button type="button" disabled={busy || !cohortId} onClick={() => submit(false)} className="btn btn-primary">
          {busy ? "Saving…" : "Enrol"}
        </button>
      </div>
    </Modal>
  );
}
