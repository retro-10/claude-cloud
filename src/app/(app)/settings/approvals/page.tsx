import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card } from "@/components/ui";
import { getSetting } from "@/lib/app-settings";
import { APPROVAL_TYPES } from "@/lib/approvals";
import { requirePageCan } from "@/lib/server-auth";
import { saveApprovalRulesAction } from "../actions";

export const metadata = { title: "Approvals · Settings" };

// Who may approve what. A request goes to the people of the first rule it matches; any one of them decides.
export default async function ApprovalSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const [rules, people] = await Promise.all([
    getSetting(db, "approvalRules"),
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  const rows = [...rules, null];
  return (
    <>
      <Flash {...sp} />
      <Card title="Approval routing" icon="check" className="max-w-4xl">
        <p className="mb-4 text-sm text-muted">
          Rules are checked from the top; the first that matches a request decides who may approve it, and any one of them can. A minimum amount applies the rule
          only from that amount, so put the larger amounts first (for example purchases from 20,000 EGP to owners only, then all purchases to finance). Nobody ever
          approves their own request: if a rule names only the requester, the owners decide. The last rule must be <b>Any request</b> with no minimum.
        </p>
        <form action={saveApprovalRulesAction}>
          <input type="hidden" name="rows" value={rows.length} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>From (EGP)</th>
                  <th>Owners</th>
                  <th>Finance</th>
                  <th>Or a person</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const person = r?.approvers.find((a) => a.startsWith("user:"))?.slice(5) ?? "";
                  const n = `rule ${i + 1}`;
                  return (
                    <tr key={i}>
                      <td>
                        <select name={`type_${i}`} defaultValue={r?.type ?? ""} className="input input-sm" aria-label={`Request type, ${n}`}>
                          {!r && <option value="">Add a rule…</option>}
                          <option value="*">Any request</option>
                          {APPROVAL_TYPES.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="number" min={0} step={1} name={`min_${i}`} defaultValue={r?.minAmountEgp ?? ""} placeholder="Any" className="input input-sm num w-28" aria-label={`Minimum amount, ${n}`} />
                      </td>
                      <td>
                        <input type="checkbox" name={`owners_${i}`} defaultChecked={r?.approvers.includes("owners") ?? false} className="check" aria-label={`Owners approve, ${n}`} />
                      </td>
                      <td>
                        <input type="checkbox" name={`finance_${i}`} defaultChecked={r?.approvers.includes("finance") ?? false} className="check" aria-label={`Finance approves, ${n}`} />
                      </td>
                      <td>
                        <select name={`user_${i}`} defaultValue={person} className="input input-sm" aria-label={`A specific approver, ${n}`}>
                          <option value="">Nobody else</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{r && <input type="checkbox" name={`remove_${i}`} className="check" aria-label={`Remove ${n}`} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary mt-4">Save</button>
        </form>
      </Card>
    </>
  );
}
