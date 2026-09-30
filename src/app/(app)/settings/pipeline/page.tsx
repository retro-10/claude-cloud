import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { stageExitCriteria, stages } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card, Icon } from "@/components/ui";
import { getSettings } from "@/lib/app-settings";
import { CHECKS, CHECK_KEYS } from "@/lib/exit-criteria";
import { requirePageCan } from "@/lib/server-auth";
import { createStageAction, moveStageAction, renameStageAction, setCriterionAction } from "../actions";

export const metadata = { title: "Stages · Settings" };
const KIND: Record<string, { label: string; cls: string }> = {
  open: { label: "open", cls: "chip-gold" },
  won: { label: "won · needs an enrolment", cls: "chip-ok" },
  lost: { label: "lost · needs a reason", cls: "chip-danger" },
  nurture: { label: "nurture", cls: "" },
};

export default async function PipelineSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const [list, criteria, settings] = await Promise.all([
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(stageExitCriteria).where(eq(stageExitCriteria.required, true)),
    getSettings(db),
  ]);
  const openCount = list.filter((s) => s.kind === "open").length;

  return (
    <>
      <Flash {...searchParams} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card title="Stages and what it takes to enter each one" icon="pipeline" bodyClass="p-0">
          <p className="border-b border-line px-4 py-3 text-sm text-muted">
            A lead moves forward when the <em>buyer</em> did something. The checks below must be true before a lead can enter the stage; owners can
            override with a reason, which goes to the audit log. The order sets the board columns and the funnel.
          </p>
          <ol className="divide-y divide-line/70">
            {list.map((s, i) => {
              const on = criteria.filter((c) => c.stageKey === s.key).map((c) => c.checkKey);
              const off = CHECK_KEYS.filter((k) => !on.includes(k));
              return (
                <li key={s.key} className="flex flex-col gap-3 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num grid h-6 w-6 place-items-center rounded-full bg-raised text-xs text-muted">{i + 1}</span>
                    <form action={renameStageAction} className="flex min-w-[14rem] flex-1 items-center gap-2">
                      <input type="hidden" name="key" value={s.key} />
                      <input name="label" defaultValue={s.label} required maxLength={60} dir="auto" aria-label={`Label for stage ${s.key}`} className="input min-w-0 flex-1 font-medium" />
                      <button className="btn btn-secondary btn-sm">Rename</button>
                    </form>
                    <span className={`chip ${KIND[s.kind].cls}`}>{KIND[s.kind].label}</span>
                    <form action={moveStageAction} className="flex gap-1">
                      <input type="hidden" name="key" value={s.key} />
                      <button name="direction" value="up" disabled={i === 0} aria-label={`Move ${s.label} up`} className="btn btn-ghost btn-sm w-7 px-0">
                        ↑
                      </button>
                      <button name="direction" value="down" disabled={i === list.length - 1} aria-label={`Move ${s.label} down`} className="btn btn-ghost btn-sm w-7 px-0">
                        ↓
                      </button>
                    </form>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-8">
                    <span className="eyebrow mr-1">To enter</span>
                    {on.length === 0 && <span className="text-xs text-muted">no checks</span>}
                    {on.map((k) => (
                      <form key={k} action={setCriterionAction}>
                        <input type="hidden" name="stageKey" value={s.key} />
                        <input type="hidden" name="checkKey" value={k} />
                        <input type="hidden" name="required" value="0" />
                        <button className="chip chip-gold hover:border-danger/50 hover:text-danger" title="Remove this check" aria-label={`Remove check: ${CHECKS[k as keyof typeof CHECKS]?.label}`}>
                          {CHECKS[k as keyof typeof CHECKS]?.label ?? k} <Icon name="x" size={10} />
                        </button>
                      </form>
                    ))}
                    <form action={setCriterionAction} className="flex items-center gap-1">
                      <input type="hidden" name="stageKey" value={s.key} />
                      <input type="hidden" name="required" value="1" />
                      <select name="checkKey" className="input input-sm w-auto" aria-label={`Add a check for ${s.label}`} defaultValue="">
                        <option value="" disabled>
                          Add a check…
                        </option>
                        {off.map((k) => (
                          <option key={k} value={k}>
                            {CHECKS[k].label}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-ghost btn-sm">Add</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="flex flex-col gap-5">
          <Card title="Add a stage" icon="plus">
            <p className="mb-3 text-sm text-muted">
              You have <span className="num text-fg">{openCount}</span> open stages. Keep it to {settings.maxOpenStages} or fewer: each extra stage is one
              more update per lead, and stages that are not kept up to date make the numbers lie.
            </p>
            <form action={createStageAction} className="flex gap-2">
              <input name="label" required maxLength={60} placeholder="e.g. Waiting for payment" aria-label="New stage name" dir="auto" className="input" />
              <button className="btn btn-primary">Add</button>
            </form>
            <p className="mt-2 text-xs text-muted">Name the state the buyer is in, never a time (“Q4 deals”, “This week”).</p>
          </Card>
          <Card title="How moves are checked" icon="shield">
            <ul className="flex flex-col gap-2 text-sm text-muted">
              <li>Automatic moves (booking or holding a consult) only happen once the checks pass.</li>
              <li>Imports of past data skip the checks: they describe history, not a move.</li>
              <li>The lead page shows what is missing for the next stage before anyone tries.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
