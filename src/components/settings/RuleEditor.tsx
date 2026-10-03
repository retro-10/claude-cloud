"use client";

import { useMemo, useState } from "react";
import type { RuleAction } from "@/db/schema";
import { Icon } from "../ui/Icon";

type Opt = [string, string];
export type RuleEditorOptions = {
  triggers: Opt[];
  conditionsFor: Record<string, readonly string[]>;
  stages: Opt[];
  sources: Opt[];
  people: Opt[]; // active users: [id, name]
  cadences: string[];
  lostReasons: string[];
};
type Draft = { name: string; trigger: string; conditions: Record<string, string>; actions: RuleAction[] };

const SEGMENTS: Opt[] = [["fresh_graduate", "Fresh graduate"], ["technician", "Technician"], ["dentist", "Dentist"], ["other", "Other"]];
const TIERS: Opt[] = [["foundation", "Foundation"], ["freelance_ready", "Freelance Ready"], ["production_partner", "Production Partner"], ["unsure", "Not sure yet"]];
const RESULTS: Opt[] = [["held", "Held"], ["no_show", "No-show"]];
const OUTCOMES: Opt[] = [["enrolled", "Enrolled"], ["thinking", "Still thinking"], ["not_fit", "Not a fit"], ["no_show", "No-show"]];
const KINDS: Opt[] = [["whatsapp", "WhatsApp"], ["call", "Call"], ["reply", "Reply to them"], ["instagram", "Instagram"], ["email", "Email"]];
const ACTIONS: Opt[] = [
  ["create_follow_up", "Create a follow-up"],
  ["notify", "Notify the lead's owner"],
  ["set_owner", "Give the lead to someone"],
  ["add_tag", "Add a tag"],
  ["apply_cadence", "Start a cadence"],
  ["cancel_cadence", "Stop the running cadence"],
  ["cancel_follow_ups", "Cancel all open follow-ups"],
];
const COND_LABEL: Record<string, string> = {
  to_stage: "Stage becomes",
  from_stage: "Stage was",
  result: "Consult result",
  outcome: "Consult outcome",
  lost_reason: "Lost reason",
  segment: "Segment",
  source: "Source",
  tier: "Tier interest",
  tag: "Has the tag",
  overdue_hours: "Overdue by (hours)",
  unassigned: "Only leads with no owner",
};

function blankAction(type: string, o: RuleEditorOptions): RuleAction {
  switch (type) {
    case "notify":
      return { type: "notify", title: "{name} needs you" };
    case "set_owner":
      return { type: "set_owner", userId: Number(o.people[0]?.[0] ?? 0) };
    case "add_tag":
      return { type: "add_tag", tag: "" };
    case "apply_cadence":
      return { type: "apply_cadence", cadence: o.cadences[0] ?? "" };
    case "cancel_cadence":
      return { type: "cancel_cadence" };
    case "cancel_follow_ups":
      return { type: "cancel_follow_ups" };
    default:
      return { type: "create_follow_up", kind: "whatsapp", note: "", dueInMinutes: 60 };
  }
}

const UNITS: [string, number][] = [["minutes", 1], ["hours", 60], ["days", 1440]];
const splitMinutes = (m: number): [number, number] => (m && m % 1440 === 0 ? [m / 1440, 1440] : m && m % 60 === 0 ? [m / 60, 60] : [m, 1]);

/**
 * Build a rule in plain words: when (trigger), only if (the conditions that trigger can have), then (up to five
 * actions, run in order). It posts the rule as JSON; the server validates every part again.
 */
export function RuleEditor({ options: o, initial, action, submit, ruleId }: { options: RuleEditorOptions; initial?: Draft; action: (f: FormData) => Promise<void>; submit: string; ruleId?: number }) {
  const [d, setD] = useState<Draft>(initial ?? { name: "", trigger: "lead_created", conditions: {}, actions: [blankAction("create_follow_up", o)] });
  const allowed = useMemo(() => o.conditionsFor[d.trigger] ?? [], [o, d.trigger]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setCond = (k: string, v: string) => setD((x) => ({ ...x, conditions: Object.fromEntries(Object.entries({ ...x.conditions, [k]: v }).filter(([, val]) => val !== "")) }));
  const setAct = (i: number, a: RuleAction) => setD((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? a : y)) }));
  // conditions the new trigger cannot have are dropped when the trigger changes
  const payload = JSON.stringify({ ...d, conditions: Object.fromEntries(Object.entries(d.conditions).filter(([k]) => allowed.includes(k))) });

  const select = (k: string, opts: Opt[]) => (
    <select value={d.conditions[k] ?? ""} onChange={(e) => setCond(k, e.target.value)} className="input">
      <option value="">Any</option>
      {opts.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  const condInput = (k: string) => {
    switch (k) {
      case "to_stage":
      case "from_stage":
        return select(k, o.stages);
      case "result":
        return select(k, RESULTS);
      case "outcome":
        return select(k, OUTCOMES);
      case "segment":
        return select(k, SEGMENTS);
      case "tier":
        return select(k, TIERS);
      case "source":
        return select(k, o.sources);
      case "lost_reason":
        return select(k, o.lostReasons.map((r) => [r, r]));
      case "overdue_hours":
        return <input type="number" min={1} max={9999} value={d.conditions[k] ?? ""} onChange={(e) => setCond(k, e.target.value)} placeholder="24" className="input num" />;
      case "tag":
        return <input value={d.conditions[k] ?? ""} onChange={(e) => setCond(k, e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="e.g. vip" className="input" />;
      default:
        return null;
    }
  };

  return (
    <form action={action} className="grid gap-6">
      {ruleId ? <input type="hidden" name="id" value={ruleId} /> : null}
      <input type="hidden" name="rule" value={payload} />
      <label className="field">
        Name
        <input value={d.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} placeholder="e.g. Instagram leads go to Sara" className="input" />
      </label>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">When</legend>
        <select aria-label="When" value={d.trigger} onChange={(e) => set({ trigger: e.target.value })} className="input">
          {o.triggers.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">Only if (leave as Any to apply to every lead)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {allowed.map((k) =>
            k === "unassigned" ? (
              <label key={k} className="flex items-center gap-3 self-end rounded-xl border border-line p-3 text-sm">
                <input type="checkbox" className="check" checked={d.conditions.unassigned === "1"} onChange={(e) => setCond("unassigned", e.target.checked ? "1" : "")} />
                {COND_LABEL[k]}
              </label>
            ) : (
              <label key={k} className="field">
                {COND_LABEL[k]}
                {condInput(k)}
              </label>
            ),
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">Then, in this order</legend>
        <ol className="grid gap-3">
          {d.actions.map((a, i) => (
            <li key={i} className="grid gap-3 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-end gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-accent" aria-hidden>
                  {i + 1}
                </span>
                <label className="field min-w-56 flex-1">
                  Action {i + 1}
                  <select value={a.type} onChange={(e) => setAct(i, blankAction(e.target.value, o))} className="input">
                    {ACTIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                {d.actions.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => set({ actions: d.actions.filter((_, j) => j !== i) })}>
                    <Icon name="trash" size={14} /> Remove
                  </button>
                )}
              </div>
              {a.type === "create_follow_up" && (
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <label className="field">
                    Kind
                    <select value={a.kind} onChange={(e) => setAct(i, { ...a, kind: e.target.value })} className="input">
                      {KINDS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    What to do
                    <input value={a.note} onChange={(e) => setAct(i, { ...a, note: e.target.value })} required maxLength={200} placeholder="e.g. Send the masterclass link" className="input" />
                  </label>
                  <fieldset className="grid gap-2 sm:col-span-2">
                    <legend className="mb-1 text-sm">Due</legend>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="radio" className="check" checked={a.dueAt !== "decision_date"} onChange={() => setAct(i, { type: "create_follow_up", kind: a.kind, note: a.note, dueInMinutes: 60 })} />
                        After
                      </label>
                      {a.dueAt !== "decision_date" &&
                        (() => {
                          const [n, unit] = splitMinutes(a.dueInMinutes ?? 0);
                          return (
                            <>
                              <input aria-label="Delay" type="number" min={0} value={n} onChange={(e) => setAct(i, { ...a, dueInMinutes: Math.max(0, Number(e.target.value)) * unit })} className="input num w-24" />
                              <select aria-label="Unit" value={unit} onChange={(e) => setAct(i, { ...a, dueInMinutes: n * Number(e.target.value) })} className="input w-auto">
                                {UNITS.map(([l, m]) => (
                                  <option key={l} value={m}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </>
                          );
                        })()}
                      <label className="flex items-center gap-2">
                        <input type="radio" className="check" checked={a.dueAt === "decision_date"} onChange={() => setAct(i, { type: "create_follow_up", kind: a.kind, note: a.note, dueAt: "decision_date" })} />
                        On the lead&apos;s decision date
                      </label>
                    </div>
                  </fieldset>
                </div>
              )}
              {a.type === "notify" && (
                <label className="field">
                  Message ({"{name}"} is the lead&apos;s name; with no owner, every owner is told)
                  <input value={a.title} onChange={(e) => setAct(i, { ...a, title: e.target.value })} required maxLength={200} className="input" />
                </label>
              )}
              {a.type === "set_owner" && (
                <label className="field">
                  Give it to
                  <select value={a.userId} onChange={(e) => setAct(i, { ...a, userId: Number(e.target.value) })} className="input">
                    {o.people.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {a.type === "add_tag" && (
                <label className="field">
                  Tag (lowercase letters, numbers and dashes)
                  <input value={a.tag} onChange={(e) => setAct(i, { ...a, tag: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} required maxLength={40} placeholder="e.g. vip" className="input" />
                </label>
              )}
              {a.type === "apply_cadence" && (
                <label className="field">
                  Cadence
                  <select value={a.cadence} onChange={(e) => setAct(i, { ...a, cadence: e.target.value })} className="input">
                    {o.cadences.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ol>
        {d.actions.length < 5 && (
          <button type="button" className="btn btn-secondary btn-sm justify-self-start" onClick={() => set({ actions: [...d.actions, blankAction("notify", o)] })}>
            <Icon name="plus" size={14} /> Add another action
          </button>
        )}
      </fieldset>

      <p className="text-xs text-muted">Rules never send a message to a lead. They create follow-ups, tags, owners and notifications for the team.</p>
      <div>
        <button className="btn btn-primary">{submit}</button>
      </div>
    </form>
  );
}
