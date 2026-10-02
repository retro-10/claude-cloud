import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { leads, sources, stages, users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { CampaignForm } from "@/components/growth/CampaignForm";
import { Card, EmptyState, Icon, PageHeader, Stat, StageChip } from "@/components/ui";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUS, campaignCosts, campaignStats } from "@/lib/campaigns";
import { STATUS_LABEL } from "@/lib/finance";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { addCampaignCostAction } from "../../actions";

export const metadata = { title: "Campaign · Growth" };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const egp = (n: number | null) => (n == null ? "—" : `${fmt(n)} EGP`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function CampaignPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const money = can(user.role, "finance:read");
  const [[c], costs, campaignLeads, src, people, stageList] = await Promise.all([
    campaignStats(db, id),
    money ? campaignCosts(db, id) : Promise.resolve([]),
    db
      .select({ id: leads.id, fullName: leads.fullName, stage: leads.stage, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.campaignId, id), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(200),
    db.select().from(sources).orderBy(asc(sources.label)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
    db.select().from(stages),
  ]);
  if (!c) notFound();
  const stage = (k: string) => stageList.find((s) => s.key === k);

  return (
    <>
      <Link href="/growth/campaigns" className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> All campaigns
      </Link>
      <PageHeader
        eyebrow={`${CAMPAIGN_KINDS[c.kind]} · ${CAMPAIGN_STATUS[c.status]}`}
        title={c.label}
        titleDir="auto"
        subtitle={[c.eventAt ? `On ${formatCairo(c.eventAt)}` : null, c.source ? `Source: ${c.source}` : null, c.slug ? `Link name: ${c.slug}` : null].filter(Boolean).join(" · ") || undefined}
      />
      <Flash notice={sp.notice} error={sp.error} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Leads" value={fmt(c.leads)} icon="leads" tone="brand" />
        <Stat label="Held a consult" value={fmt(c.consulted)} hint={`${pct(c.consulted, c.leads)} of leads`} icon="phone" />
        <Stat label="Enrolled" value={fmt(c.enrolled)} hint={`${pct(c.enrolled, c.leads)} of leads`} icon="cohorts" />
        {money ? (
          <Stat label="Spend" value={egp(c.spendEgp)} hint={`${c.budgetEgp != null ? `of ${egp(c.budgetEgp)} budget · ` : ""}${c.owedEgp ? `${egp(c.owedEgp)} still owed` : "nothing owed"}`} icon="trend" />
        ) : (
          <Stat label="Consult to enrolment" value={pct(c.enrolled, c.consulted)} icon="target" />
        )}
      </div>
      {money && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Cost per lead" value={egp(c.costPerLead)} icon="gauge" />
          <Stat label="Cost per enrolment" value={egp(c.costPerEnrolment)} icon="gauge" />
          <Stat label="Revenue from its students" value={egp(c.revenueEgp)} icon="trend" />
          <Stat label="Return on spend" value={c.roi == null ? "—" : `${c.roi >= 0 ? "+" : ""}${Math.round(c.roi * 100)}%`} hint="(revenue − spend) ÷ spend" icon="target" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Leads (${c.leads})`} icon="leads" bodyClass="p-0">
          {campaignLeads.length === 0 ? (
            <EmptyState icon="leads" title="No leads tagged to this campaign yet." />
          ) : (
            <ul className="divide-y divide-line">
              {campaignLeads.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link href={`/leads/${l.id}`} className="link min-w-0 flex-1 truncate text-sm" dir="auto">
                    {l.fullName}
                  </Link>
                  <span className="text-xs text-muted">{formatCairo(l.createdAt, false)}</span>
                  <StageChip label={stage(l.stage)?.label ?? l.stage} kind={stage(l.stage)?.kind} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          {money && (
            <Card title="Costs" icon="trend">
              {costs.length === 0 ? (
                <p className="text-sm text-muted">No costs tagged yet.</p>
              ) : (
                <ul className="mb-3 divide-y divide-line">
                  {costs.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {x.entry}
                      </span>
                      <span className="text-xs text-muted">{STATUS_LABEL[x.status]}</span>
                      <span className="num">{egp(x.amountEgp)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {can(user.role, "payment:write") && (
                <form action={addCampaignCostAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="campaignId" value={c.id} />
                  <label className="field sm:col-span-2">
                    What was paid for
                    <input name="entry" required maxLength={200} className="input input-sm" placeholder="e.g. Instagram ads, week 1" />
                  </label>
                  <label className="field">
                    Amount (EGP)
                    <input name="amountEgp" required inputMode="numeric" className="input input-sm num" />
                  </label>
                  <label className="field">
                    Status
                    <select name="status" defaultValue="paid" className="input input-sm">
                      <option value="paid">Paid</option>
                      <option value="owed">Owed</option>
                    </select>
                  </label>
                  <label className="field">
                    Date
                    <input name="date" type="date" className="input input-sm" />
                  </label>
                  <label className="field">
                    Category
                    <select name="category" defaultValue="Ads & promotion" className="input input-sm">
                      {["Ads & promotion", "Content creator", "Video production", "Freelancers & sales", "Equipment"].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  <div className="sm:col-span-2">
                    <button className="btn btn-secondary btn-sm">Record cost</button>
                    <span className="ml-2 text-xs text-muted">Goes into the ledger as a variable cost.</span>
                  </div>
                </form>
              )}
            </Card>
          )}
          {can(user.role, "growth:write") && (
            <Card title="Edit campaign" icon="edit">
              <CampaignForm c={c} sources={src} people={people} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
