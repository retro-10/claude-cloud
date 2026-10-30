import Link from "next/link";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ScrollX } from "@/components/ui/ScrollX";
import { getSettings } from "@/lib/app-settings";
import { listFunctions, salaries, type FunctionRow } from "@/lib/cycle";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { removeFunctionAction, saveFunctionAction } from "../../finance/rebuild/actions";

export const metadata = { title: "Functions & owners · Team" };

const APPLIES = { both: "Both", core: "Core", camp: "Camp" } as const;

function FunctionForm({ f, partners }: { f?: FunctionRow; partners: string[] }) {
  return (
    <form action={saveFunctionAction} className="grid gap-3 sm:grid-cols-2">
      {f && <input type="hidden" name="id" value={f.id} />}
      <input type="hidden" name="back" value="/team/functions" />
      <label className="field sm:col-span-2">
        Function
        <input name="name" required maxLength={120} defaultValue={f?.name} className="input input-sm" placeholder="e.g. Design production" />
      </label>
      <label className="field sm:col-span-2">
        What has to happen
        <textarea name="description" rows={2} maxLength={1000} defaultValue={f?.description ?? ""} className="input input-sm" />
      </label>
      <label className="field">
        Applies to
        <select name="appliesTo" defaultValue={f?.appliesTo ?? "both"} className="input input-sm">
          {Object.entries(APPLIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Weight (0.5 for a split lane)
        <input name="weight" type="number" min={0.1} max={5} step="0.5" required defaultValue={f?.weight ?? 1} className="input input-sm num" />
      </label>
      <label className="field">
        Accountable partner
        <select name="accountable" defaultValue={f?.accountable ?? ""} className="input input-sm">
          <option value="">Nobody yet</option>
          {partners.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>Supporting</legend>
        <div className="flex flex-wrap gap-3 pt-1">
          {partners.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm font-normal text-fg">
              <input type="checkbox" name="supporting" value={p} defaultChecked={f?.supporting.includes(p)} className="check" /> {p}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field sm:col-span-2">
        Staff and contractors
        <input name="staff" maxLength={300} defaultValue={f?.staff ?? ""} className="input input-sm" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{f ? "Save" : "Add function"}</button>
      </div>
    </form>
  );
}

// Who answers for what across both companies: one accountable partner per function, others supporting. The
// accountable load sets each partner's share of the salary pool (Finance > Partner pay).
export default async function FunctionsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("hq:read");
  const [fns, s] = await Promise.all([listFunctions(db), getSettings(db)]);
  const m = s.financeModel;
  const partners = m.newShares.map((p) => p.name);
  const write = can(user.role, "settings:write");
  const load = salaries(m, partners, fns);
  const noOwner = fns.filter((f) => !f.accountable);

  return (
    <>
      <PageHeader
        eyebrow="Team & ops"
        title="Functions & owners"
        subtitle="What both companies need to run, who is accountable for each function and who supports. One accountable partner per line; the accountable load sets each partner's share of the salary pool."
      />
      <Flash notice={sp.notice} error={sp.error} />
      <TeamTabs current="/team/functions" />

      <div className="flex flex-col gap-6">
        <section aria-label="Partners" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {load.map((p) => {
            const prof = m.partners.find((x) => x.name === p.name);
            return (
              <div key={p.name} className="card p-4">
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="text-xs text-accent">{prof?.role || "Partner"}</div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span>
                    <span className="font-semibold tabular-nums">{p.accountable}</span> <span className="text-muted">accountable</span>
                  </span>
                  <span>
                    <span className="font-semibold tabular-nums">{p.supporting}</span> <span className="text-muted">supporting</span>
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {Math.round(p.share * 1000) / 10}% of the salary pool{p.multiplier !== 1 ? ` (load ×${p.multiplier})` : ""}
                </div>
                {prof?.outcome && <p className="mt-3 border-t border-line pt-2 text-xs text-muted">Judged on: {prof.outcome}</p>}
              </div>
            );
          })}
        </section>

        <Card
          title="Functions"
          icon="list"
          bodyClass="p-0"
          actions={noOwner.length ? <span className="chip chip-warn">{noOwner.length} without an accountable partner</span> : fns.length ? <span className="chip chip-ok">Every line has one accountable partner</span> : null}
        >
          {!fns.length ? (
            <div className="p-5">
              <EmptyState icon="list" title="No functions recorded">
                Import the Cycle Close workbook (Finance &gt; Import workbook) to take its Function Owners table, or add the functions below.
              </EmptyState>
            </div>
          ) : (
            <ScrollX label="Functions">
              <table className="table min-w-[980px]">
                <thead>
                  <tr>
                    <th scope="col">Function</th>
                    <th scope="col">For</th>
                    <th scope="col" className="text-right">
                      Weight
                    </th>
                    {partners.map((p) => (
                      <th key={p} scope="col" className="text-center">
                        {p}
                      </th>
                    ))}
                    <th scope="col">Staff and contractors</th>
                    {write && (
                      <th scope="col">
                        <span className="sr-only">Edit</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {fns.map((f) => (
                    <tr key={f.id} className="align-top">
                      <th scope="row" className="max-w-[300px] font-normal">
                        <span className="font-medium">{f.name}</span>
                        {f.description && <span className="block text-xs text-muted">{f.description}</span>}
                      </th>
                      <td>{APPLIES[f.appliesTo as keyof typeof APPLIES] ?? f.appliesTo}</td>
                      <td className="text-right tabular-nums">{f.weight}</td>
                      {partners.map((p) => (
                        <td key={p} className="text-center">
                          {f.accountable === p ? (
                            <span className="chip chip-brand" title="Accountable">
                              A
                            </span>
                          ) : f.supporting.includes(p) ? (
                            <span className="chip" title="Supporting">
                              S
                            </span>
                          ) : (
                            <span className="text-faint">·</span>
                          )}
                        </td>
                      ))}
                      <td className="max-w-[220px] text-xs text-muted">{f.staff ?? ""}</td>
                      {write && (
                        <td className="whitespace-nowrap">
                          <details className="relative">
                            <summary className="btn btn-ghost btn-sm cursor-pointer list-none" aria-label={`Edit ${f.name}`}>
                              <Icon name="edit" size={14} />
                            </summary>
                            <div className="absolute right-0 z-20 mt-2 w-[min(90vw,520px)] rounded-xl border border-line bg-surface p-4 shadow-pop">
                              <FunctionForm f={f} partners={partners} />
                              <form action={removeFunctionAction} className="mt-3 border-t border-line pt-3">
                                <input type="hidden" name="id" value={f.id} />
                                <input type="hidden" name="back" value="/team/functions" />
                                <ConfirmButton className="btn btn-danger btn-sm" message={`Remove “${f.name}”?`}>
                                  Remove
                                </ConfirmButton>
                              </form>
                            </div>
                          </details>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          {write && (
            <Card title="Add a function" icon="plus">
              <FunctionForm partners={partners} />
            </Card>
          )}
          <Card
            title="Decision rights"
            icon="shield"
            bodyClass="p-0"
            actions={
              write && (
                <Link href="/settings/finance" className="btn btn-ghost btn-sm">
                  Edit
                </Link>
              )
            }
          >
            <ul className="divide-y divide-line/70">
              {s.decisionRights.map((d, i) => (
                <li key={i} className="grid gap-1 px-5 py-3 sm:grid-cols-2">
                  <span className="text-sm font-medium">{d.decision}</span>
                  <span className="text-sm text-muted">{d.who}</span>
                </li>
              ))}
              {!s.decisionRights.length && <li className="px-5 py-4 text-sm text-muted">None recorded.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
