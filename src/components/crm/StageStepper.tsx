"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../ui/Icon";
import { EnrolDialog, MoveDialog, type CohortLite, type LeadLite, type StageLite } from "./StageDialogs";

/**
 * The pipeline as a row of steps on the lead page. Clicking a stage opens the move dialog, which asks for
 * what the move needs and shows any unmet exit criteria (the server re-checks everything).
 */
export function StageStepper(props: {
  stages: StageLite[];
  current: string;
  lead: LeadLite;
  lostReasons: { id: number; label: string; kind?: string }[];
  cohorts: CohortLite[];
  canWrite: boolean;
  isOwner: boolean;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [to, setTo] = useState<StageLite | null>(null);
  const cur = props.stages.find((s) => s.key === props.current);
  const path = props.stages.filter((s) => s.kind === "open" || s.kind === "won");
  const side = props.stages.filter((s) => s.kind === "lost" || s.kind === "nurture");
  const curIdx = path.findIndex((s) => s.key === props.current);
  const locked = cur?.kind === "won" || !props.canWrite;
  const done = () => {
    setTo(null);
    router.refresh();
  };

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Pipeline stages">
        {path.map((s, i) => {
          const isCur = s.key === props.current;
          const past = curIdx >= 0 && i < curIdx;
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={locked || isCur}
                onClick={() => setTo(s)}
                aria-current={isCur ? "step" : undefined}
                title={isCur ? "Current stage" : `Move to ${s.label}`}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isCur
                    ? s.kind === "won"
                      ? "border-ok/50 bg-ok/15 text-ok"
                      : "border-brand/60 bg-brand/15 text-accent shadow-glow"
                    : past
                      ? "border-line bg-raised text-fg hover:border-brand/50"
                      : "border-line/70 text-muted hover:border-brand/50 hover:text-fg"
                } disabled:cursor-default`}
              >
                {past && <Icon name="check" size={12} className="text-ok" />}
                {s.label}
              </button>
              {i < path.length - 1 && <span aria-hidden className={`h-px w-3 ${past ? "bg-brand/60" : "bg-line"}`} />}
            </li>
          );
        })}
        <li aria-hidden className="mx-1 h-4 w-px bg-line" />
        {side.map((s) => {
          const isCur = s.key === props.current;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={locked || isCur}
                onClick={() => setTo(s)}
                aria-current={isCur ? "step" : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isCur ? (s.kind === "lost" ? "border-danger/50 bg-danger/15 text-danger" : "border-line bg-raised text-fg") : "border-dashed border-line text-muted hover:text-fg"
                } disabled:cursor-default`}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      {to && to.kind !== "won" && (
        <MoveDialog lead={props.lead} to={to} lostReasons={props.lostReasons} canOverride={props.canOverride} onCancel={() => setTo(null)} onDone={done} />
      )}
      {to?.kind === "won" && <EnrolDialog lead={props.lead} cohorts={props.cohorts} isOwner={props.isOwner} onCancel={() => setTo(null)} onDone={done} />}
    </div>
  );
}
