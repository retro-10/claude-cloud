import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources, users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { CampaignForm } from "@/components/growth/CampaignForm";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUS, campaignStats } from "@/lib/campaigns";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Campaigns · Growth" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const egp = (n: number | null) => (n == null ? "—" : `${fmt(n)} EGP`);
const STATUS_CHIP = { planned: "chip", live: "chip chip-ok", ended: "chip" } as const;

// Every campaign with what it brought: leads, consults, enrolments, and (owners and finance) what it cost.
export default async function CampaignsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const money = can(user.role, "finance:read");
  const [rows, src, people] = await Promise.all([
    campaignStats(db),
    db.select().from(sources).orderBy(asc(sources.label)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  const live = rows.filter((r) => r.status === "live");
  const total = (k: "leads" | "enrolled" | "spendEgp" | "revenueEgp") => rows.reduce((a, r) => a + r[k], 0);
  const spend = total("spendEgp"), enrolled = total("enrolled");

  return (
    <>
      <PageHeader eyebrow="Growth" title="Campaigns" subtitle="Masterclasses, ads and collaborations: what each brought in, and what it cost. Spend is the ledger costs tagged to the campaign." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Live campaigns" value={live.length} icon="bolt" tone="brand" />
        <Stat label="Leads from campaigns" value={fmt(total("leads"))} icon="leads" />
        <Stat label="Enrolled from campaigns" value={fmt(enrolled)} icon="cohorts" />
        {money ? <Stat label="Cost per enrolment" value={spend && enrolled ? egp(Math.round(spend / enrolled)) : "—"} hint={`${egp(spend)} spent in all`} icon="trend" /> : <Stat label="Campaigns" value={rows.length} icon="layers" />}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="All campaigns" icon="target" bodyClass="p-0 overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState icon="target" title="No campaigns yet.">
              Create one for each masterclass, ad run or collaboration, then tag its leads and costs.
            </EmptyState>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Campaign</th>
                  <th scope="col" className="text-right">Leads</th>
                  <th scope="col" className="text-right">Consulted</th>
                  <th scope="col" className="text-right">Enrolled</th>
                  {money && (
                    <>
                      <th scope="col" className="text-right">Spend</th>
                      <th scope="col" className="text-right">Per lead</th>
                      <th scope="col" className="text-right">Per enrolment</th>
                      <th scope="col" className="text-right">Revenue</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="min-w-[220px]">
                      <Link href={`/growth/campaigns/${r.id}`} className="link font-medium" dir="auto">
                        {r.label}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className={STATUS_CHIP[r.status]}>{CAMPAIGN_STATUS[r.status]}</span>
                        {CAMPAIGN_KINDS[r.kind]}
                      </div>
                      {r.eventAt && <div className="mt-0.5 text-xs text-muted">{formatCairo(r.eventAt)}</div>}
                    </td>
                    <td className="num text-right">{fmt(r.leads)}</td>
                    <td className="num text-right">{fmt(r.consulted)}</td>
                    <td className="num text-right">{fmt(r.enrolled)}</td>
                    {money && (
                      <>
                        <td className="num text-right">{egp(r.spendEgp)}</td>
                        <td className="num text-right">{egp(r.costPerLead)}</td>
                        <td className="num text-right">{egp(r.costPerEnrolment)}</td>
                        <td className="num text-right">{egp(r.revenueEgp)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        {can(user.role, "growth:write") && (
          <Card title="New campaign" icon="plus">
            <CampaignForm sources={src} people={people} />
          </Card>
        )}
      </div>
    </>
  );
}
