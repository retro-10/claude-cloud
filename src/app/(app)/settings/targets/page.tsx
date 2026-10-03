import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { progressFor, quarterOf, shiftQuarter } from "@/lib/targets";
import { saveTargetsAction } from "./actions";

export const metadata = { title: "Targets · Settings" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

// Owners set what each quarter should deliver; the Command centre shows progress and pace against it.
export default async function TargetsSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const now = new Date();
  const current = quarterOf(now);
  const quarters = await Promise.all([current, shiftQuarter(current, 1)].map((q) => progressFor(db, q, now)));

  return (
    <>
      <Flash notice={sp.notice} error={sp.error} />
      <p className="mb-5 max-w-3xl text-sm text-muted">
        What each quarter should deliver. Leave a box empty for no target. Quarters follow the Cairo calendar (Q4 = October to December). Progress and pace
        show on the Command centre; revenue and cash only to owners and finance.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {quarters.map((q) => (
          <Card key={q.period} title={q.period === current ? `${q.period} (this quarter)` : q.period} icon="target">
            <form action={saveTargetsAction} className="grid gap-3">
              <input type="hidden" name="period" value={q.period} />
              {q.rows.map((r) => (
                <label key={r.metric} className="field">
                  <span className="flex items-baseline justify-between gap-2">
                    <span>
                      {r.label}
                      {r.unit === "egp" ? " (EGP)" : ""}
                    </span>
                    <span className="text-xs font-normal text-muted">so far {fmt(r.actual)}</span>
                  </span>
                  <input name={r.metric} inputMode="numeric" defaultValue={r.target ?? ""} className="input num" aria-describedby={`${q.period}-${r.metric}-hint`} />
                  <span id={`${q.period}-${r.metric}-hint`} className="text-xs font-normal text-muted">
                    {r.hint}
                  </span>
                </label>
              ))}
              <div>
                <button className="btn btn-primary btn-sm">Save {q.period}</button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
