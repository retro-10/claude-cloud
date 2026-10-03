import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources, users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { DEFAULTS, getSettings } from "@/lib/app-settings";
import { requirePageCan } from "@/lib/server-auth";
import { saveAssignmentAction, saveThresholdsAction } from "../actions";

export const metadata = { title: "Thresholds · Settings" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];

function NumberField({ name, label, value, def, unit, min = 1, max }: { name: string; label: string; value: number; def: number; unit: string; min?: number; max?: number }) {
  return (
    <label className="field">
      {label}
      <span className="flex items-center gap-2">
        <input type="number" name={name} defaultValue={value} min={min} max={max} required className="input num w-24" />
        <span className="text-xs font-normal text-muted">
          {unit} · default {def}
        </span>
      </span>
    </label>
  );
}

export default async function RulesSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const [s, people, srcs] = await Promise.all([
    getSettings(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(sources).orderBy(asc(sources.id)),
  ]);
  const routes = [...s.routes, ...Array(Math.max(0, 6 - s.routes.length)).fill(null)] as (typeof s.routes[number] | null)[];

  return (
    <>
      <Flash {...searchParams} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Response time and lead health" icon="gauge">
          <form action={saveThresholdsAction} className="flex flex-col gap-6">
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="eyebrow mb-3">Speed to lead</legend>
              <NumberField name="slaTargetMin" label="Target first reply" value={s.slaTargetMin} def={DEFAULTS.slaTargetMin} unit="min" max={1440} />
              <NumberField name="slaAmberMin" label="Amber from" value={s.slaAmberMin} def={DEFAULTS.slaAmberMin} unit="min" max={1440} />
              <NumberField name="slaRedMin" label="Red from" value={s.slaRedMin} def={DEFAULTS.slaRedMin} unit="min" max={10080} />
            </fieldset>
            <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-xs font-medium text-muted">Working hours (Cairo)</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="whEnabled" defaultChecked={s.workingHours.enabled} className="check" />
                Only count waiting time inside working hours
              </label>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input type="time" name="whStart" defaultValue={s.workingHours.start} aria-label="Start" className="input w-auto" />
                <span className="text-muted">to</span>
                <input type="time" name="whEnd" defaultValue={s.workingHours.end} aria-label="End" className="input w-auto" />
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5">
                    <input type="checkbox" name="whDays" value={i} defaultChecked={s.workingHours.days.includes(i)} className="check" /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="eyebrow mb-3">Lead health</legend>
              <NumberField name="neglectDays" label="Neglected after no activity for" value={s.neglectDays} def={DEFAULTS.neglectDays} unit="days" max={365} />
              <NumberField name="staleDays" label="Stale after no stage change for" value={s.staleDays} def={DEFAULTS.staleDays} unit="days" max={365} />
              <NumberField name="decisionDueDays" label="Offer without a decision date is due after" value={s.decisionDueDays} def={DEFAULTS.decisionDueDays} unit="days" max={60} />
              <NumberField name="maxOpenStages" label="Warn above this many open stages" value={s.maxOpenStages} def={DEFAULTS.maxOpenStages} unit="stages" min={3} max={20} />
            </fieldset>
            <button className="btn btn-primary self-start">Save thresholds</button>
          </form>
        </Card>

        <Card title="Who owns new leads" icon="user">
          <form action={saveAssignmentAction} className="flex flex-col gap-4">
            <label className="field">
              Default owner when no route matches
              <select name="defaultOwnerId" defaultValue={s.defaultOwnerId ?? ""} className="input">
                <option value="">Whoever adds the lead</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="eyebrow mb-2">Routes (first match wins)</div>
              <div className="flex flex-col gap-2">
                {routes.map((r, i) => (
                  <div key={i} className="grid grid-cols-[7rem_1fr_8rem] gap-2">
                    <select name={`field_${i}`} defaultValue={r?.field ?? ""} aria-label={`Route ${i + 1}: match on`} className="input input-sm">
                      <option value="">—</option>
                      <option value="source">Source is</option>
                      <option value="segment">Segment is</option>
                    </select>
                    <input name={`value_${i}`} defaultValue={r?.value ?? ""} list="route-values" aria-label={`Route ${i + 1}: value`} className="input input-sm" />
                    <select name={`user_${i}`} defaultValue={r?.userId ?? ""} aria-label={`Route ${i + 1}: owner`} className="input input-sm">
                      <option value="">Owner…</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <datalist id="route-values">
                  {srcs.map((x) => (
                    <option key={x.id} value={x.label} />
                  ))}
                  {SEGMENTS.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </div>
            </div>
            <p className="text-xs text-muted">Unassigned leads that wait past the red response time alert every owner (workflow rule “Unassigned new lead”).</p>
            <button className="btn btn-primary self-start">Save routing</button>
          </form>
        </Card>
      </div>
    </>
  );
}
