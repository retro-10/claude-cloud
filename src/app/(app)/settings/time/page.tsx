import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { getSetting } from "@/lib/app-settings";
import { requirePageCan } from "@/lib/server-auth";
import { saveAuxCodesAction } from "../actions";

export const metadata = { title: "Time & away · Settings" };

// The away statuses people pick from the clock in the top bar while they are clocked in.
export default async function TimeSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const codes = await getSetting(db, "auxCodes");
  const rows = [...codes, null];
  return (
    <>
      <Flash {...sp} />
      <Card title="Away statuses" icon="snooze" className="max-w-3xl">
        <p className="mb-4 text-sm text-muted">
          While clocked in, people pick one of these from <b>Away</b> beside the clock, and <b>Back</b> when they return. Everyone sees the status in Team calendar &gt;
          Right now. Time on a status that is not paid comes off the hours; the payroll export shows the minutes per status either way. A limit marks the status red for
          everyone once it runs longer.
        </p>
        <form action={saveAuxCodesAction}>
          <input type="hidden" name="rows" value={rows.length} />
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Counts as paid work</th>
                <th>Limit (minutes)</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c?.key ?? "new"}>
                  <td>
                    {c && <input type="hidden" name={`key_${i}`} value={c.key} />}
                    <label className="sr-only" htmlFor={`label_${i}`}>
                      {c ? `Name of ${c.label}` : "New status"}
                    </label>
                    <input id={`label_${i}`} name={`label_${i}`} defaultValue={c?.label ?? ""} placeholder={c ? undefined : "Add a status, e.g. Meeting"} maxLength={40} className="input input-sm" />
                  </td>
                  <td>
                    <input type="checkbox" name={`paid_${i}`} defaultChecked={c?.paid ?? false} className="check" aria-label={`${c?.label ?? "New status"} counts as paid work`} />
                  </td>
                  <td>
                    <input
                      type="number"
                      name={`max_${i}`}
                      min={1}
                      max={600}
                      defaultValue={c?.maxMinutes ?? ""}
                      placeholder="None"
                      className="input input-sm num w-24"
                      aria-label={`Limit for ${c?.label ?? "the new status"}, in minutes`}
                    />
                  </td>
                  <td>{c && <input type="checkbox" name={`remove_${i}`} className="check" aria-label={`Remove ${c.label}`} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-primary mt-4">Save</button>
        </form>
      </Card>
    </>
  );
}
