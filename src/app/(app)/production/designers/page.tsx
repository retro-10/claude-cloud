import { db } from "@/db";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { designerStats } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Designers · Production" };
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

// Each designer's load and quality over the last 90 days: who to give the next case to, and what they earned.
export default async function DesignersPage() {
  const user = await requirePageCan("production:read");
  if (!can(user.role, "production:manage") && !can(user.role, "finance:read")) return <EmptyState icon="user" title="Designer figures are for owners and finance." />;
  const rows = await designerStats(db, new Date(Date.now() - 90 * 86_400_000));
  return (
    <>
      <PageHeader eyebrow="Production studio" title="Designers" subtitle="Open cases now, and over the cases delivered in the last 90 days: passed QC the first time, delivered on time, turnaround and pay." />
      <ProductionTabs role={user.role} current="/production/designers" />
      <Card bodyClass="p-0">
        {!rows.length ? (
          <EmptyState icon="user" title="No cases assigned yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Designer</th>
                  <th scope="col" className="text-right">Open now</th>
                  <th scope="col" className="text-right">Delivered</th>
                  <th scope="col" className="text-right">First-time QC pass</th>
                  <th scope="col" className="text-right">On time</th>
                  <th scope="col" className="text-right">Avg. turnaround</th>
                  <th scope="col" className="text-right">Pay earned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <th scope="row" className="font-medium">
                      {d.name}
                    </th>
                    <td className="num text-right">{d.open}</td>
                    <td className="num text-right">{d.delivered}</td>
                    <td className="num text-right">{pct(d.firstPassRate)}</td>
                    <td className="num text-right">{pct(d.onTimeRate)}</td>
                    <td className="num text-right">{d.avgDays == null ? "—" : `${d.avgDays} days`}</td>
                    <td className="num text-right">{egp(d.pay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
