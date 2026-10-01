import { db } from "@/db";
import { RoiCalculator } from "@/components/tools/RoiCalculator";
import { PageHeader } from "@/components/ui";
import { campaignStats } from "@/lib/campaigns";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { plannerDefaults } from "@/lib/tools-data";

export const metadata = { title: "Campaign ROI · Tools" };

export default async function RoiPage() {
  const user = await requireUser();
  const [d, camps] = await Promise.all([plannerDefaults(db), can(user.role, "finance:read") ? campaignStats(db) : Promise.resolve([])]);
  // actual average cost per lead across campaigns with spend (owners and finance only: it is spend data)
  const spent = camps.filter((c) => c.spendEgp > 0 && c.leads > 0);
  const cpl = spent.length ? Math.round(spent.reduce((a, c) => a + c.spendEgp, 0) / spent.reduce((a, c) => a + c.leads, 0)) : null;
  return (
    <>
      <PageHeader eyebrow="Tools" title="Campaign ROI" subtitle="Before you spend: what a budget should bring in leads, consults, enrolments and revenue at your own rates, and the most a lead can cost before the campaign loses money." />
      <RoiCalculator d={{ costPerLead: cpl, leadToConsult: d.leadToConsult, consultToEnrol: d.consultToEnrol, avgPriceEgp: d.avgPriceEgp, fromData: d.fromData }} />
    </>
  );
}
