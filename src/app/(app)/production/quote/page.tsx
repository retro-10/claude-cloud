import Link from "next/link";
import { db } from "@/db";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { QuoteTool } from "@/components/production/QuoteTool";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listCaseTypes, listClients } from "@/lib/production";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Turnaround quote · Production" };

export default async function QuotePage() {
  const user = await requirePageCan("production:manage");
  const [types, clients] = await Promise.all([listCaseTypes(db, { activeOnly: true }), listClients(db, { activeOnly: true })]);
  return (
    <>
      <PageHeader eyebrow="Production studio" title="Turnaround quote" subtitle="What a case will cost a client and when it will be ready, before you take it in. Same rules as intake." />
      <ProductionTabs role={user.role} current="/production/quote" />
      <Card>
        {types.length ? (
          <QuoteTool
            types={types.map((t) => ({ id: t.id, name: t.name, unitPriceEgp: t.unitPriceEgp, standardDays: t.standardDays, rushDays: t.rushDays, rushSurchargePct: t.rushSurchargePct }))}
            clients={clients.map((c) => ({ id: c.id, name: c.name, discountPct: c.discountPct }))}
          />
        ) : (
          <EmptyState icon="list" title="No price list yet.">
            Add case types in the <Link href="/production/prices" className="link">price list</Link> first.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
