import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cadenceTemplates, leads, sources, stages, workflowRules, workflowRuns } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { TRIGGERS, describeAction } from "@/lib/workflows";
import { createRuleAction, deleteRuleAction, editRuleAction, toggleRuleAction } from "../actions";

export const metadata = { title: "Workflows · Settings" };

const COND_LABEL: Record<string, string> = { to_stage: "stage", result: "result", outcome: "outcome", segment: "segment", source: "source", tier: "tier", lost_reason: "lost reason", overdue_hours: "overdue by (h)", unassigned: "unassigned" };

export default async function WorkflowSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const [rules, runs, stageList, srcs, cads] = await Promise.all([
    db.select().from(workflowRules).orderBy(asc(workflowRules.position), asc(workflowRules.id)),
    db
      .select({ r: workflowRuns, rule: workflowRules.name, lead: leads.fullName })
      .from(workflowRuns)
      .leftJoin(workflowRules, eq(workflowRules.id, workflowRuns.ruleId))
      .leftJoin(leads, eq(leads.id, workflowRuns.leadId))
      .orderBy(desc(workflowRuns.firedAt), desc(workflowRuns.id))
      .limit(40),
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id)),
  ]);
  const condText = (k: string, v: string) =>
    k === "to_stage" ? `stage is ${stageList.find((s) => s.key === v)?.label ?? v}` : k === "source" ? `source is ${srcs.find((s) => String(s.id) === v)?.label ?? v}` : `${COND_LABEL[k] ?? k} ${v === "1" ? "" : `is ${v.replace(/_/g, " ")}`}`.trim();

  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Rules turn events into tasks, tags and notifications so nothing depends on memory. <strong className="text-fg">Rules never send a message</strong>:
        every message still goes out by hand from WhatsApp.
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {rules.map((r) => (
            <section key={r.id} aria-label={r.name} className={`card p-4 ${r.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${r.enabled ? "border-gold/40 bg-gold/10 text-accent" : "border-line text-muted"}`}>
                  <Icon name="flow" size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">{r.name}</h2>
                  <p className="mt-1 text-xs text-muted">
                    <span className="text-fg">When</span> {TRIGGERS[r.trigger as keyof typeof TRIGGERS]?.toLowerCase() ?? r.trigger}
                    {Object.entries(r.conditions).length > 0 && (
                      <>
                        {" "}
                        <span className="text-fg">and</span> {Object.entries(r.conditions).map(([k, v]) => condText(k, v)).join(", ")}
                      </>
                    )}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {r.actions.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <Icon name="arrowRight" size={12} className="text-accent" />
                        {describeAction(a)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  {r.builtin && <span className="chip">built-in</span>}
                  <form action={toggleRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                    <button role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? "on" : "off"}`} className={`relative h-6 w-11 rounded-full border transition ${r.enabled ? "border-gold/60 bg-gold/80" : "border-line bg-raised"}`}>
                      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-fg shadow transition-all ${r.enabled ? "left-[22px] bg-ink" : "left-0.5"}`} />
                    </button>
                  </form>
                </div>
              </div>
              <details className="mt-3 pl-11">
                <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
                  <Icon name="edit" size={12} /> Edit
                </summary>
                <form action={editRuleAction} className="well mt-2 flex flex-col gap-3 p-3">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="field">
                    Name
                    <input name="name" defaultValue={r.name} className="input" />
                  </label>
                  {r.trigger === "follow_up_overdue" && (
                    <label className="field">
                      Overdue by (hours)
                      <input type="number" name="overdue_hours" min={1} defaultValue={r.conditions.overdue_hours ?? "24"} className="input num w-28" />
                    </label>
                  )}
                  {r.actions.map((a, i) =>
                    a.type === "create_follow_up" ? (
                      <div key={i} className="grid grid-cols-[1fr_7rem] gap-2">
                        <label className="field">
                          Follow-up note
                          <input name={`note_${i}`} defaultValue={a.note} className="input" />
                        </label>
                        {!a.dueAt && (
                          <label className="field">
                            Due in (min)
                            <input type="number" min={0} name={`minutes_${i}`} defaultValue={a.dueInMinutes ?? 0} className="input num" />
                          </label>
                        )}
                      </div>
                    ) : a.type === "notify" ? (
                      <label key={i} className="field">
                        Notification text ({"{name}"} = lead name)
                        <input name={`note_${i}`} defaultValue={a.title} className="input" />
                      </label>
                    ) : null,
                  )}
                  <div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm">Save</button>
                    {!r.builtin && (
                      <button formAction={deleteRuleAction} className="btn btn-ghost btn-sm text-danger">
                        Delete rule
                      </button>
                    )}
                  </div>
                </form>
              </details>
            </section>
          ))}

          <Card title="New rule" icon="plus">
            <form action={createRuleAction} className="grid gap-3 sm:grid-cols-2">
              <label className="field sm:col-span-2">
                Name
                <input name="name" required maxLength={120} placeholder="e.g. Instagram leads: tag them" className="input" />
              </label>
              <label className="field">
                When
                <select name="trigger" className="input">
                  {Object.entries(TRIGGERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Only if the stage becomes
                <select name="c_to_stage" className="input" defaultValue="">
                  <option value="">Any</option>
                  {stageList.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Only if the source is
                <select name="c_source" className="input" defaultValue="">
                  <option value="">Any</option>
                  {srcs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Only if the segment is
                <select name="c_segment" className="input" defaultValue="">
                  <option value="">Any</option>
                  {["fresh_graduate", "technician", "dentist", "other"].map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Then
                <select name="a_type" className="input">
                  <option value="create_follow_up">Create a follow-up</option>
                  <option value="notify">Notify the owner</option>
                  <option value="add_tag">Add a tag</option>
                  <option value="apply_cadence">Start a cadence</option>
                  <option value="cancel_follow_ups">Cancel open follow-ups</option>
                </select>
              </label>
              <label className="field">
                Delay for a follow-up (min)
                <input type="number" name="a_minutes" min={0} defaultValue={60} className="input num" />
              </label>
              <label className="field sm:col-span-2">
                Note, notification text, tag or cadence name
                <input name="a_text" list="cadence-names" placeholder="e.g. Send the masterclass link" className="input" />
                <datalist id="cadence-names">
                  {cads.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </label>
              <button className="btn btn-primary self-start">Create rule</button>
            </form>
          </Card>
        </div>

        <Card title="Run log" icon="history" bodyClass="p-0">
          {runs.length === 0 ? (
            <EmptyState icon="flow" title="No rule has fired yet" />
          ) : (
            <ol className="divide-y divide-line/70">
              {runs.map(({ r, rule, lead }) => (
                <li key={r.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{rule}</span>
                    <span className="num text-xs text-muted">{formatCairo(r.firedAt)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {r.leadId && (
                      <Link href={`/leads/${r.leadId}`} dir="auto" className="text-fg hover:text-accent">
                        {lead}
                      </Link>
                    )}{" "}
                    · {r.result}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
