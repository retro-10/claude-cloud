import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { listInvoices } from "@/lib/invoices";
import { listClients } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { createInvoiceAction } from "../actions";

export const metadata = { title: "Invoices · Production" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

// Invoices to clients: what is ready to invoice, what was issued, paid and still owed.
export default async function InvoicesPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const write = can(user.role, "payment:write");
  const [rows, clients] = await Promise.all([listInvoices(db), listClients(db)]);
  const ready = clients.filter((c) => c.toInvoice > 0);
  const live = rows.filter((r) => r.status === "issued");
  const owed = live.reduce((a, r) => a + r.owed, 0);
  const overdue = live.filter((r) => r.overdue);

  return (
    <>
      <PageHeader eyebrow="Production studio" title="Invoices" subtitle="Invoice delivered cases, record what clients pay, and see who owes what. Every invoice is in the ledger as client work." />
      <ProductionTabs role={user.role} current="/production/invoices" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Owed by clients" value={egp(owed)} icon="trend" />
        <Stat label="Overdue" value={overdue.length} icon="alert" hint={overdue.length ? egp(overdue.reduce((a, r) => a + r.owed, 0)) : "none"} />
        <Stat label="Clients to invoice" value={ready.length} icon="send" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title={`Invoices (${rows.length})`} icon="note" bodyClass="p-0">
          {!rows.length ? (
            <EmptyState icon="note" title="No invoices yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col">Client</th>
                    <th scope="col">Due</th>
                    <th scope="col" className="text-right">Total</th>
                    <th scope="col" className="text-right">Owed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.status === "void" ? "opacity-60" : ""}>
                      <td>
                        <Link href={`/production/invoices/${r.id}`} className="link font-medium">
                          {r.number}
                        </Link>
                        <div className="text-xs text-muted">{r.status === "void" ? "void" : formatCairo(r.issuedAt, false)}</div>
                      </td>
                      <td dir="auto">{r.clientName}</td>
                      <td className={r.overdue ? "font-medium text-danger" : ""}>
                        {formatCairo(r.dueAt, false)}
                        {r.overdue ? " · overdue" : ""}
                      </td>
                      <td className="num text-right">{egp(r.totalEgp)}</td>
                      <td className="num text-right">{r.status === "void" ? "—" : r.owed ? egp(r.owed) : <span className="chip chip-ok">paid</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Ready to invoice" icon="send">
          {!ready.length ? (
            <p className="text-sm text-muted">No delivered cases waiting for an invoice.</p>
          ) : (
            <ul className="divide-y divide-line">
              {ready.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <Link href={`/production/clients/${c.id}`} className="link min-w-0 flex-1 truncate" dir="auto">
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted">
                    {c.toInvoice} case{c.toInvoice === 1 ? "" : "s"}
                  </span>
                  {write && (
                    <form action={createInvoiceAction}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <button className="btn btn-secondary btn-sm">Invoice</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">One invoice for all of a client&apos;s delivered cases. To invoice only some, choose them on the client&apos;s page.</p>
        </Card>
      </div>
    </>
  );
}
