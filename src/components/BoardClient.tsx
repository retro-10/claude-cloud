"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { enrolAction, moveLead } from "@/app/(app)/pipeline/actions";
import { LIST_PRICE_EGP } from "@/lib/pricing";

type Stage = { key: string; label: string; kind: "open" | "won" | "lost" | "nurture" };
type Card = {
  id: number;
  fullName: string;
  tierInterest: string;
  stage: string;
  daysInStage: number;
  nextFollowUp: string | null;
  overdue: boolean;
};
type Cohort = { id: number; name: string; seatCap: number; used: number };
type Pending = { card: Card; to: Stage } | null;

const TIERS = ["foundation", "freelance_ready", "production_partner"] as const;
const pretty = (s: string) => s.replace(/_/g, " ");
const field = "rounded border border-line bg-bg px-2 py-1.5 text-sm w-full";

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short" }).format(new Date(iso));

export function BoardClient(props: {
  stages: Stage[];
  cards: Card[];
  totals: Record<string, number>;
  lostReasons: { id: number; label: string }[];
  cohorts: Cohort[];
  canWrite: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(props.cards);
  const [totals, setTotals] = useState(props.totals);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null); // read in drop: state may not have flushed yet
  const [overStage, setOverStage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const applyMove = (card: Card, to: string) => {
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: to, daysInStage: 0 } : c)));
    setTotals((t) => ({ ...t, [card.stage]: Math.max(0, (t[card.stage] ?? 1) - 1), [to]: (t[to] ?? 0) + 1 }));
    router.refresh(); // pull real counts and card order from the server
  };

  // A move needs extra info for lost (reason) and enrolled (enrolment); everything else goes straight through.
  const requestMove = (card: Card, to: Stage) => {
    setError("");
    if (!props.canWrite || card.stage === to.key) return;
    if (to.kind === "lost" || to.kind === "won") return setPending({ card, to });
    startTransition(async () => {
      const r = await moveLead({ leadId: card.id, stage: to.key });
      if (r.ok) applyMove(card, to.key);
      else setError(r.error);
    });
  };

  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className={`flex gap-2 overflow-x-auto pb-4 ${busy ? "opacity-70" : ""}`}>
        {props.stages.map((st) => {
          const col = cards.filter((c) => c.stage === st.key);
          const total = totals[st.key] ?? col.length;
          return (
            <section
              key={st.key}
              aria-label={st.label}
              onDragOver={(e) => {
                if (dragRef.current !== null) {
                  e.preventDefault();
                  setOverStage(st.key);
                }
              }}
              onDragLeave={() => setOverStage((s) => (s === st.key ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                const card = cards.find((c) => c.id === dragRef.current);
                dragRef.current = null;
                setDragId(null);
                if (card) requestMove(card, st);
              }}
              className={`min-w-[8.5rem] flex-1 basis-0 rounded border bg-surface/60 p-2 ${overStage === st.key ? "border-gold" : "border-line"}`}
            >
              <h2 className="mb-2 flex items-center justify-between text-sm font-medium">
                {st.label}
                <span className="rounded bg-bg px-1.5 text-xs text-muted" title={total > col.length ? `Showing ${col.length} of ${total}` : undefined}>
                  {total}
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {col.map((c) => (
                  <li
                    key={c.id}
                    draggable={props.canWrite}
                    onDragStart={() => {
                      dragRef.current = c.id;
                      setDragId(c.id);
                    }}
                    onDragEnd={() => {
                      dragRef.current = null;
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={`rounded border bg-bg p-2 text-sm ${props.canWrite ? "cursor-grab" : ""} ${c.overdue ? "border-danger/60" : "border-line"} ${dragId === c.id ? "opacity-40" : ""}`}
                  >
                    <Link href={`/leads/${c.id}`} dir="auto" className="block font-medium hover:text-accent">
                      {c.fullName}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{pretty(c.tierInterest)}</span>
                      <span>{c.daysInStage}d in stage</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {c.nextFollowUp ? (
                        <span className={c.overdue ? "font-medium text-danger" : "text-muted"}>
                          {c.overdue ? "Overdue · " : "Next · "}
                          {shortDate(c.nextFollowUp)}
                        </span>
                      ) : (
                        <span className="text-muted">No follow-up</span>
                      )}
                    </div>
                    {props.canWrite && (
                      <select
                        aria-label={`Move ${c.fullName} to stage`}
                        value=""
                        onChange={(e) => {
                          const to = props.stages.find((s) => s.key === e.target.value);
                          if (to) requestMove(c, to);
                        }}
                        className="mt-2 w-full rounded border border-line bg-surface px-1 py-1 text-xs text-muted"
                      >
                        <option value="">Move to…</option>
                        {props.stages
                          .filter((s) => s.key !== c.stage)
                          .map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                ))}
                {col.length === 0 && <li className="py-3 text-center text-xs text-muted">Empty</li>}
              </ul>
            </section>
          );
        })}
      </div>

      {pending?.to.kind === "lost" && (
        <LostDialog
          card={pending.card}
          reasons={props.lostReasons}
          onCancel={() => setPending(null)}
          onDone={() => {
            applyMove(pending.card, pending.to.key);
            setPending(null);
          }}
          stageKey={pending.to.key}
        />
      )}
      {pending?.to.kind === "won" && (
        <EnrolDialog
          card={pending.card}
          cohorts={props.cohorts}
          isOwner={props.isOwner}
          onCancel={() => setPending(null)}
          onDone={() => {
            applyMove(pending.card, pending.to.key);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]" onClick={onCancel}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 font-display text-xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function LostDialog(props: {
  card: Card;
  stageKey: string;
  reasons: { id: number; label: string }[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, start] = useTransition();
  return (
    <Modal title="Mark as lost" onCancel={props.onCancel}>
      <p className="mb-3 text-sm" dir="auto">
        {props.card.fullName}
      </p>
      <label className="mb-3 flex flex-col gap-1 text-xs text-muted">
        Lost reason (required)
        <select autoFocus className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose…</option>
          {props.reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={props.onCancel} className="px-3 py-1.5 text-sm text-muted">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (!reason) return setError("Pick a lost reason.");
            start(async () => {
              const r = await moveLead({ leadId: props.card.id, stage: props.stageKey, lostReasonId: Number(reason) });
              if (r.ok) props.onDone();
              else setError(r.error);
            });
          }}
          className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
        >
          Mark lost
        </button>
      </div>
    </Modal>
  );
}

function EnrolDialog(props: { card: Card; cohorts: Cohort[]; isOwner: boolean; onCancel: () => void; onDone: () => void }) {
  const initialTier = (TIERS as readonly string[]).includes(props.card.tierInterest)
    ? (props.card.tierInterest as (typeof TIERS)[number])
    : "foundation";
  const [tier, setTier] = useState<(typeof TIERS)[number]>(initialTier);
  const [amount, setAmount] = useState(String(LIST_PRICE_EGP[initialTier] ?? ""));
  const [cohortId, setCohortId] = useState(String(props.cohorts[0]?.id ?? ""));
  const [paidOn, setPaidOn] = useState("");
  const [ref, setRef] = useState("");
  const [gateway, setGateway] = useState<"paymob" | "other">("other");
  const [override, setOverride] = useState(false);
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const [busy, start] = useTransition();

  const cohort = props.cohorts.find((c) => String(c.id) === cohortId);
  const isFull = cohort ? cohort.used >= cohort.seatCap : false;

  return (
    <Modal title="Enrol student" onCancel={props.onCancel}>
      <p className="mb-3 text-sm" dir="auto">
        {props.card.fullName}
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Cohort
          <select className={field} value={cohortId} onChange={(e) => { setCohortId(e.target.value); setFull(false); setOverride(false); }}>
            {props.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.used}/{c.seatCap} seats)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Tier
          <select
            className={field}
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
        <label className="flex flex-col gap-1 text-xs text-muted">
          Amount (EGP)
          <input className={field} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} placeholder={tier === "production_partner" ? "Custom price" : ""} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Paid on (optional)
            <input type="date" className={field} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Gateway
            <select className={field} value={gateway} onChange={(e) => setGateway(e.target.value as "paymob" | "other")}>
              <option value="other">other</option>
              <option value="paymob">paymob</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Payment reference (optional)
          <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" />
        </label>
        {(isFull || full) && props.isOwner && (
          <label className="flex items-center gap-2 text-sm text-warn">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Cohort is full: override the seat cap
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={props.onCancel} className="px-3 py-1.5 text-sm text-muted">
            Cancel
          </button>
          <button
            disabled={busy || !cohortId}
            onClick={() =>
              start(async () => {
                setError("");
                const r = await enrolAction({
                  leadId: props.card.id,
                  cohortId: Number(cohortId),
                  tier,
                  amountEgp: Number(amount),
                  paidOn: paidOn || null,
                  paymentRef: ref || null,
                  gateway,
                  overrideCap: override,
                });
                if (r.ok) props.onDone();
                else {
                  setError(r.error);
                  if (r.cohortFull) setFull(true);
                }
              })
            }
            className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Enrol"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
