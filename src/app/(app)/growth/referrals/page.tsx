import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { can } from "@/lib/rbac";
import { REWARD_STATUS, listReferrers, listRewards, syncRewards } from "@/lib/referrals";
import { requirePageCan } from "@/lib/server-auth";
import { decideRewardAction } from "./actions";

export const metadata = { title: "Referrals · Growth" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const CHIP = { pending: "chip chip-warn", approved: "chip chip-brand", paid: "chip chip-ok", declined: "chip" } as const;

// Who brings people in. A reward is decided by a person when someone they referred enrols.
export default async function ReferralsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const money = can(user.role, "finance:read");
  const pay = can(user.role, "payment:write");
  await syncRewards(db);
  const [people, rewards] = await Promise.all([listReferrers(db), money ? listRewards(db) : Promise.resolve([])]);
  const referred = people.reduce((a, p) => a + p.referred, 0);
  const enrolled = people.reduce((a, p) => a + p.enrolled, 0);

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Referrals"
        subtitle="Students and graduates who bring people in. Make someone's referral link on their lead page; anyone who signs up through it is marked as referred by them."
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="People referring" value={people.length} icon="user" tone="brand" />
        <Stat label="Referred" value={referred} icon="leads" />
        <Stat label="Of those, enrolled" value={enrolled} hint={referred ? `${Math.round((enrolled / referred) * 100)}%` : undefined} icon="cohorts" />
        {money && <Stat label="Rewards to decide" value={rewards.filter((r) => r.w.status === "pending").length} icon="flag" />}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Who refers" icon="user" bodyClass="p-0 overflow-x-auto">
          {people.length === 0 ? (
            <EmptyState icon="user" title="No referrals yet.">
              Open a student&rsquo;s page and press <em>Make referral link</em> in the Referrals card.
            </EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Code</th>
                  <th scope="col" className="text-right">Referred</th>
                  <th scope="col" className="text-right">Enrolled</th>
                  {money && <th scope="col" className="text-right">Rewards paid</th>}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/leads/${p.id}`} className="link" dir="auto">
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="num text-xs">{p.code ?? "—"}</td>
                    <td className="num text-right">{p.referred}</td>
                    <td className="num text-right">{p.enrolled}</td>
                    {money && <td className="num text-right">{p.paidEgp ? `${fmt(p.paidEgp)} EGP` : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {money && (
          <Card title="Rewards" icon="trend">
            <p className="mb-3 text-xs text-muted">A row appears when someone referred enrols. The amount is yours to set (the reward rules are the owners&rsquo;); Paid records the cost in the ledger.</p>
            {rewards.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rewards.map(({ w, referrer, referred: who }) => (
                  <li key={w.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span dir="auto">{referrer}</span>
                      <span className="text-muted">referred</span>
                      <span dir="auto">{who}</span>
                      <span className={CHIP[w.status]}>{REWARD_STATUS[w.status]}</span>
                      {w.amountEgp && <span className="num text-xs">{fmt(w.amountEgp)} EGP</span>}
                    </div>
                    {pay && w.status !== "paid" && (
                      <form action={decideRewardAction} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={w.id} />
                        <label className="field">
                          Amount (EGP)
                          <input name="amountEgp" inputMode="numeric" defaultValue={w.amountEgp ?? ""} className="input input-sm num w-28" />
                        </label>
                        <label className="field min-w-0 flex-1">
                          Note
                          <input name="note" maxLength={200} defaultValue={w.note ?? ""} className="input input-sm" />
                        </label>
                        <button name="status" value="approved" className="btn btn-secondary btn-sm">Approve</button>
                        <button name="status" value="paid" className="btn btn-primary btn-sm">Paid</button>
                        <button name="status" value="declined" className="btn btn-ghost btn-sm">Decline</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
