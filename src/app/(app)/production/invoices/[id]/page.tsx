import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { getInvoice } from "@/lib/invoices";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd, formatCairo } from "@/lib/time";
import { recordInvoicePaymentAction, voidInvoiceAction } from "../../actions";
import { ScrollX } from "@/components/ui/ScrollX";

export const metadata = { title: "Invoice · Production" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

export default async function InvoicePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("finance:read");
  const inv = await getInvoice(db, Number(id));
  if (!inv) notFound();
  const write = can(user.role, "payment:write");
  const live = inv.status === "issued";
  const overdue = live && inv.owed > 0 && inv.dueAt < new Date();

  return (
    <>
      <Link href="/production/invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Invoices
      </Link>
      <PageHeader
        eyebrow={
          <Link href={`/production/clients/${inv.clientId}`} className="hover:underline">
            {inv.clientName}
          </Link>
        }
        title={inv.number}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {inv.status === "void" ? <span className="chip chip-danger">void</span> : inv.owed ? <span className={overdue ? "chip chip-danger" : "chip chip-warn"}>{overdue ? "overdue" : "open"}</span> : <span className="chip chip-ok">paid</span>}
            Issued {formatCairo(inv.issuedAt, false)} · due {formatCairo(inv.dueAt, false)}
          </span>
        }
        actions={
          <a href={`/invoices/${inv.id}`} className="btn btn-secondary btn-sm">
            <Icon name="download" size={14} /> Print or PDF
          </a>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card title="Cases" icon="layers" bodyClass="p-0">
            <ScrollX label="Cases">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.caseId}>
                      <td>
                        <Link href={`/production/cases/${l.caseId}`} className="link">
                          {l.code}
                        </Link>
                      </td>
                      <td dir="auto">{l.description}</td>
                      <td className="num text-right">{egp(l.amountEgp)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" colSpan={2} className="text-right">
                      Total
                    </th>
                    <td className="num text-right font-semibold">{egp(inv.totalEgp)}</td>
                  </tr>
                </tbody>
              </table>
            </ScrollX>
          </Card>
          {inv.notes && (
            <Card title="Notes" icon="note">
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {inv.notes}
              </p>
            </Card>
          )}
          {inv.status === "void" && (
            <Card title="Void" icon="ban">
              <p className="text-sm" dir="auto">
                {inv.voidReason}
              </p>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Payments" icon="trend">
            <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
              <dt className="text-muted">Paid</dt>
              <dd className="num text-right">{egp(inv.paid)}</dd>
              <dt className="text-muted">Still owed</dt>
              <dd className="num text-right font-semibold">{egp(inv.owed)}</dd>
            </dl>
            {inv.payments.length > 0 && (
              <ul className="mb-3 divide-y divide-line border-y border-line text-sm">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {formatCairo(p.date ?? p.createdAt, false)}
                      {p.reference && p.reference !== inv.number ? <span className="text-xs text-muted"> · {p.reference}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="num">{egp(p.amountEgp)}</span>
                      <a href={`/receipts/${p.id}`} className="link text-xs">
                        Receipt
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {write && live && inv.owed > 0 && (
              <form action={recordInvoicePaymentAction} className="grid gap-2">
                <input type="hidden" name="id" value={inv.id} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="field">
                    Amount (EGP)
                    <input name="amountEgp" type="number" min={1} max={inv.owed} defaultValue={inv.owed} required className="input input-sm num" />
                  </label>
                  <label className="field">
                    Received on
                    <input name="date" type="date" defaultValue={cairoYmd(new Date())} className="input input-sm" />
                  </label>
                </div>
                <label className="field">
                  Transfer reference (optional)
                  <input name="reference" maxLength={120} className="input input-sm" />
                </label>
                <button className="btn btn-primary btn-sm justify-self-start">Record payment</button>
              </form>
            )}
          </Card>
          {write && live && inv.paid === 0 && (
            <Card title="Issued by mistake?" icon="ban">
              <form action={voidInvoiceAction} className="grid gap-2">
                <input type="hidden" name="id" value={inv.id} />
                <label className="field">
                  Reason
                  <input name="reason" required maxLength={300} className="input input-sm" />
                </label>
                <button className="btn btn-danger btn-sm justify-self-start">Void the invoice</button>
                <p className="text-xs text-muted">Its cases go back to Delivered and can be invoiced again. The number is not reused.</p>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
