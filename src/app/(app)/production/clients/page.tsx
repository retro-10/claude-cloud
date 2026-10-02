import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ClientForm } from "@/components/production/ClientForm";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { CLIENT_KIND, listClients, seesMoney } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Clients · Production" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

export default async function ClientsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("production:read");
  const manage = can(user.role, "production:manage");
  const money = seesMoney(user);
  if (!manage && !money) return <EmptyState icon="user" title="Clients are for owners and finance." />;
  const rows = await listClients(db);
  return (
    <>
      <PageHeader eyebrow="Production studio" title="Clients" subtitle="The clinics and labs that send design work, their discount and payment terms." />
      <ProductionTabs role={user.role} current="/production/clients" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title={`Clients (${rows.length})`} icon="user" bodyClass="p-0">
          {!rows.length ? (
            <EmptyState icon="user" title="No clients yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col" className="text-right">Open cases</th>
                    <th scope="col" className="text-right">To invoice</th>
                    {money && <th scope="col" className="text-right">Owed</th>}
                    <th scope="col">Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                      <td>
                        <Link href={`/production/clients/${c.id}`} className="link font-medium" dir="auto">
                          {c.name}
                        </Link>
                        <div className="text-xs text-muted">
                          {CLIENT_KIND[c.kind]}
                          {c.active ? "" : " · inactive"}
                        </div>
                      </td>
                      <td className="num text-right">{c.open}</td>
                      <td className="num text-right">{c.toInvoice}</td>
                      {money && <td className="num text-right">{c.owed ? egp(c.owed) : "—"}</td>}
                      <td className="text-xs text-muted">
                        {c.discountPct ? `−${c.discountPct}% · ` : ""}
                        {c.paymentTermsDays} days
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {manage && (
          <Card title="Add a client" icon="plus">
            <ClientForm />
          </Card>
        )}
      </div>
    </>
  );
}
