"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { moveLead } from "@/app/(app)/pipeline/actions";
import type { Missing } from "@/lib/exit-criteria";
import { ComposeButton } from "./crm/Composer";
import { EnrolDialog, MoveDialog, type CohortLite, type StageLite } from "./crm/StageDialogs";
import { Icon } from "./ui/Icon";

type Card = {
  id: number;
  fullName: string;
  tierInterest: string;
  stage: string;
  daysInStage: number;
  nextFollowUp: string | null;
  overdue: boolean;
  phone: string | null;
  doNotContact: boolean;
  owner: string | null;
  source: string | null;
  offerAmountEgp: number | null;
  decisionDueAt: string | null;
  neglected: boolean;
  stale: boolean;
  noNextStep: boolean;
  tags: string[];
};
type Pending = { card: Card; to: StageLite; missing?: Missing[]; canOverride?: boolean } | null;

const pretty = (s: string) => s.replace(/_/g, " ");
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "short" }).format(new Date(iso));
const egp = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} EGP`;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

const ACCENT: Record<StageLite["kind"], string> = {
  open: "from-gold/70 to-gold/0",
  won: "from-ok/80 to-ok/0",
  lost: "from-danger/70 to-danger/0",
  nurture: "from-muted/60 to-muted/0",
};

export function BoardClient(props: {
  stages: StageLite[];
  cards: Card[];
  totals: Record<string, number>;
  values: Record<string, number>;
  lostReasons: { id: number; label: string; kind?: string }[];
  cohorts: CohortLite[];
  canWrite: boolean;
  isOwner: boolean;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(props.cards);
  const [totals, setTotals] = useState(props.totals);
  useEffect(() => setCards(props.cards), [props.cards]);
  useEffect(() => setTotals(props.totals), [props.totals]);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null); // read in drop: state may not have flushed yet
  const [overStage, setOverStage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return cards.filter((c) => (!q || c.fullName.toLowerCase().includes(q)) && (!flaggedOnly || c.neglected || c.stale || c.noNextStep || c.overdue));
  }, [cards, filter, flaggedOnly]);

  const applyMove = (card: Card, to: string) => {
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: to, daysInStage: 0 } : c)));
    setTotals((t) => ({ ...t, [card.stage]: Math.max(0, (t[card.stage] ?? 1) - 1), [to]: (t[to] ?? 0) + 1 }));
    router.refresh(); // pull real counts, flags and card order from the server
  };

  // Lost needs a reason, Enrolled needs the enrolment, a lead with no next step needs one; everything
  // else is tried straight away, and if exit criteria are missing the dialog shows what is needed.
  const requestMove = (card: Card, to: StageLite) => {
    setError("");
    if (!props.canWrite || card.stage === to.key) return;
    if (to.kind === "lost" || to.kind === "won") return setPending({ card, to });
    if (card.noNextStep) return setPending({ card, to });
    startTransition(async () => {
      const r = await moveLead({ leadId: card.id, stage: to.key });
      if (r.ok) applyMove(card, to.key);
      else if (r.missing?.length) setPending({ card, to, missing: r.missing, canOverride: r.canOverride });
      else setError(r.error);
    });
  };

  const flagged = cards.filter((c) => c.neglected || c.stale || c.noNextStep || c.overdue).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Filter cards by name</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name…" dir="auto" className="input pl-9" />
        </label>
        <button
          type="button"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((v) => !v)}
          className={`btn btn-sm h-9 ${flaggedOnly ? "btn-secondary border-warn/50 text-warn" : "btn-ghost border border-line"}`}
        >
          <Icon name="flag" size={14} /> Needs attention <span className="count">{flagged}</span>
        </button>
        <span className="ml-auto hidden text-xs text-muted md:inline">Drag cards between columns, or use “Move to…” on a card.</span>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className={`-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-6 sm:-mx-6 sm:px-6 ${busy ? "opacity-80" : ""}`}>
        {props.stages.map((st) => {
          const col = visible.filter((c) => c.stage === st.key);
          const total = totals[st.key] ?? col.length;
          const value = props.values[st.key] ?? 0;
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
              className={`relative flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl border bg-surface/50 transition-colors ${
                overStage === st.key ? "border-gold/70 bg-gold/5" : "border-line"
              }`}
            >
              <div aria-hidden className={`absolute inset-x-4 top-0 h-[2px] rounded-full bg-gradient-to-r ${ACCENT[st.kind]}`} />
              <h2 className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-3.5">
                <span className="text-sm font-semibold">{st.label}</span>
                <span className="count" title={total > col.length ? `Showing ${col.length} of ${total}` : undefined}>
                  {total}
                </span>
              </h2>
              {st.kind === "open" && value > 0 && <p className="num -mt-1 px-3.5 pb-2 text-[11px] text-muted">{egp(value)} offered</p>}
              <ul className="flex min-h-[4rem] flex-1 flex-col gap-2 px-2 pb-2">
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
                    className={`group rounded-xl border bg-raised/80 p-3 text-sm shadow-soft transition hover:-translate-y-px hover:border-gold/40 hover:shadow-lift ${
                      props.canWrite ? "cursor-grab active:cursor-grabbing" : ""
                    } ${c.overdue ? "border-danger/50" : "border-line"} ${dragId === c.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <Link href={`/leads/${c.id}`} dir="auto" className="min-w-0 flex-1 font-medium leading-snug hover:text-accent">
                        {c.fullName}
                      </Link>
                      {c.owner && (
                        <span title={`Owner: ${c.owner}`} className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-gold/30 bg-surface text-[10px] font-semibold text-accent">
                          {initials(c.owner)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {c.tierInterest !== "unsure" && <span className="chip capitalize">{pretty(c.tierInterest)}</span>}
                      <span className="chip num" title="Days in this stage">
                        <Icon name="clock" size={11} /> {c.daysInStage}d
                      </span>
                      {c.neglected && <span className="chip chip-warn">neglected</span>}
                      {c.stale && <span className="chip chip-warn">stale</span>}
                      {c.noNextStep && <span className="chip chip-danger">no next step</span>}
                      {c.doNotContact && <span className="chip chip-danger">do not contact</span>}
                    </div>
                    {(c.offerAmountEgp || c.decisionDueAt) && (
                      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
                        {c.offerAmountEgp ? <span className="num">{egp(c.offerAmountEgp)}</span> : null}
                        {c.decisionDueAt && <span>decides {shortDate(c.decisionDueAt)}</span>}
                      </div>
                    )}
                    <div className="mt-2.5 flex items-center gap-2 border-t border-line/70 pt-2 text-xs">
                      {c.nextFollowUp ? (
                        <span className={`flex items-center gap-1 ${c.overdue ? "font-medium text-danger" : "text-muted"}`}>
                          <Icon name="calendar" size={12} />
                          {c.overdue ? "Overdue · " : "Next · "}
                          {shortDate(c.nextFollowUp)}
                        </span>
                      ) : (
                        <span className="text-muted">No follow-up</span>
                      )}
                      <span className="ml-auto">{props.canWrite && <ComposeButton leadId={c.id} phone={c.phone} doNotContact={c.doNotContact} label="" />}</span>
                    </div>
                    {props.canWrite && (
                      <select
                        aria-label={`Move ${c.fullName} to stage`}
                        value=""
                        onChange={(e) => {
                          const to = props.stages.find((s) => s.key === e.target.value);
                          if (to) requestMove(c, to);
                        }}
                        className="input input-sm mt-2 w-full text-muted opacity-80 transition group-hover:opacity-100"
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
                {col.length === 0 && <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-line py-6 text-xs text-muted">Empty</li>}
              </ul>
            </section>
          );
        })}
      </div>

      {pending && pending.to.kind !== "won" && (
        <MoveDialog
          lead={{ id: pending.card.id, fullName: pending.card.fullName, tierInterest: pending.card.tierInterest, hasNextStep: !pending.card.noNextStep }}
          to={pending.to}
          lostReasons={props.lostReasons}
          initialMissing={pending.missing}
          canOverride={pending.canOverride ?? props.canOverride}
          onCancel={() => setPending(null)}
          onDone={() => {
            applyMove(pending.card, pending.to.key);
            setPending(null);
          }}
        />
      )}
      {pending?.to.kind === "won" && (
        <EnrolDialog
          lead={{ id: pending.card.id, fullName: pending.card.fullName, tierInterest: pending.card.tierInterest, hasNextStep: true, offerAmountEgp: pending.card.offerAmountEgp }}
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
