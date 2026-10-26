import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { and, like } from "drizzle-orm";
import { cadenceTemplates, leads, lostReasons, sources, stages, users, workflowRules, workflowRuns } from "@/db/schema";
import { RuleEditor, type RuleEditorOptions } from "@/components/settings/RuleEditor";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { CONDITIONS_FOR, TRIGGERS, describeAction, ruleStats } from "@/lib/workflows";
import { createRuleAction, deleteRuleAction, editRuleAction, toggleRuleAction } from "../actions";

export const metadata = { title: "Workflows · Settings" };

const COND_LABEL: Record<string, string> = { to_stage: "stage becomes", from_stage: "stage was", result: "result", outcome: "outcome", segment: "segment", source: "source", tier: "tier", lost_reason: "lost reason", overdue_hours: "overdue by (h)", unassigned: "no owner", tag: "tag" };

export default async function WorkflowSettings(props: { searchParams: Promise<{ notice?: string; error?: string; rule?: string; failed?: string }> }) {
  const { rule: ruleParam, failed, ...searchParams } = await props.searchParams;
  await requirePageCan("settings:write");
  const ruleFilter = Number(ruleParam) || null;
  const [rules, runs, stageList, srcs, cads, people, reasons, stats] = await Promise.all([
    db.select().from(workflowRules).orderBy(asc(workflowRules.position), asc(workflowRules.id)),
    db
      .select({ r: workflowRuns, rule: workflowRules.name, lead: leads.fullName })
      .from(workflowRuns)
      .leftJoin(workflowRules, eq(workflowRules.id, workflowRuns.ruleId))
      .leftJoin(leads, eq(leads.id, workflowRuns.leadId))
      .where(and(ruleFilter ? eq(workflowRuns.ruleId, ruleFilter) : undefined, failed === "1" ? like(workflowRuns.result, "failed:%") : undefined))
      .orderBy(desc(workflowRuns.firedAt), desc(workflowRuns.id))
      .limit(60),
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.label)),
    ruleStats(db),
  ]);
  const options: RuleEditorOptions = {
    triggers: Object.entries(TRIGGERS),
    conditionsFor: CONDITIONS_FOR,
    stages: stageList.map((x) => [x.key, x.label]),
    sources: srcs.map((x) => [String(x.id), x.label]),
    people: people.map((x) => [String(x.id), x.name]),
    cadences: cads.map((c) => c.name),
    lostReasons: reasons.map((r) => r.label),
  };
  const personName = new Map(people.map((x) => [x.id, x.name]));
  const filtered = ruleFilter ? rules.find((r) => r.id === ruleFilter) : null;
  const condText = (k: string, v: string) =>
    k === "to_stage" || k === "from_stage" ? `${COND_LABEL[k]} ${stageList.find((s) => s.key === v)?.label ?? v}` : k === "unassigned" ? "it has no owner" : k === "source" ? `source is ${srcs.find((s) => String(s.id) === v)?.label ?? v}` : `${COND_LABEL[k] ?? k} ${v === "1" ? "" : `is ${v.replace(/_/g, " ")}`}`.trim();

  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Rules turn events into tasks, tags and notifications so nothing depends on memory. <strong className="text-fg">Rules never send a message</strong>:
        every message still goes out by hand from WhatsApp.
      </p>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {rules.map((r) => (
            <section key={r.id} aria-label={r.name} className={`card p-4 ${r.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start gap-3">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${r.enabled ? "border-brand/40 bg-brand/10 text-accent" : "border-line text-muted"}`}>
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
                        {a.type === "set_owner" ? `Give the lead to ${personName.get(a.userId) ?? "someone no longer active"}` : describeAction(a)}
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const st = stats.get(r.id);
                    return (
                      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span>{st ? `Fired ${st.fired} time${st.fired === 1 ? "" : "s"} in 30 days, last ${formatCairo(st.last!)}` : "Not fired in the last 30 days"}</span>
                        {st?.failed ? (
                          <Link href={`/settings/workflows?rule=${r.id}&failed=1#log`} className="chip chip-danger">
                            {st.failed} failed
                          </Link>
                        ) : null}
                        {st ? (
                          <Link href={`/settings/workflows?rule=${r.id}#log`} className="link">
                            See its runs
                          </Link>
                        ) : null}
                      </p>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  {r.builtin && <span className="chip">built-in</span>}
                  <form action={toggleRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="enabled" value={r.enabled ? "0" : "1"} />
                    <button role="switch" aria-checked={r.enabled} aria-label={`${r.name}: ${r.enabled ? "on" : "off"}`} className={`relative h-6 w-11 rounded-full border transition ${r.enabled ? "border-brand/60 bg-brand/80" : "border-line bg-raised"}`}>
                      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-fg shadow transition-all ${r.enabled ? "left-[22px] bg-white" : "left-0.5"}`} />
                    </button>
                  </form>
                </div>
              </div>
              <details className="mt-3 pl-11">
                <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
                  <Icon name="edit" size={12} /> Edit
                </summary>
                {!r.builtin ? (
                  <div className="well mt-3 grid gap-4 p-4">
                    <RuleEditor options={options} action={editRuleAction} ruleId={r.id} submit="Save the rule" initial={{ name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions }} />
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn btn-ghost btn-sm text-danger">
                        <Icon name="trash" size={14} /> Delete rule
                      </button>
                    </form>
                  </div>
                ) : (
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
                  </div>
                </form>
                )}
              </details>
            </section>
          ))}

          <Card title="New rule" icon="plus">
            <RuleEditor options={options} action={createRuleAction} submit="Create rule" />
          </Card>
        </div>

        <Card title={filtered ? `Run log: ${filtered.name}` : "Run log"} icon="history" bodyClass="p-0">
          <div id="log" className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-sm">
            <Link href={`/settings/workflows${ruleFilter ? `?rule=${ruleFilter}` : ""}#log`} aria-current={failed !== "1" ? "page" : undefined} className={`chip ${failed !== "1" ? "chip-brand" : ""}`}>
              All runs
            </Link>
            <Link href={`/settings/workflows?failed=1${ruleFilter ? `&rule=${ruleFilter}` : ""}#log`} aria-current={failed === "1" ? "page" : undefined} className={`chip ${failed === "1" ? "chip-brand" : ""}`}>
              Only failures
            </Link>
            {ruleFilter ? (
              <Link href="/settings/workflows#log" className="link ml-auto">
                Every rule
              </Link>
            ) : null}
          </div>
          {runs.length === 0 ? (
            <EmptyState icon="flow" title={failed === "1" ? "No failed runs" : "No rule has fired yet"} />
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
                    · <span className={r.result.startsWith("failed:") ? "font-medium text-danger" : undefined}>{r.result}</span>
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
