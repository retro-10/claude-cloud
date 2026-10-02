import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ClientForm } from "@/components/production/ClientForm";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { listInvoices, uninvoiced } from "@/lib/invoices";
import { CASE_STATUS, CLIENT_KIND, caseCode, getClient, listCases, seesMoney } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { createInvoiceAction } from "../../actions";

export const metadata = { title: "Client · Production" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

export default async function ClientPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("production:read");
  const manage = can(user.role, "production:manage");
  const money = seesMoney(user);
  if (!manage && !money) notFound();
  const c = await getClient(db, Number(id));
  if (!c) notFound();
  const write = can(user.role, "payment:write");
  const [cases, invs, ready] = await Promise.all([listCases(db, user, { clientId: c.id }), money ? listInvoices(db, { clientId: c.id }) : Promise.resolve([]), uninvoiced(db, c.id)]);
  const owed = invs.filter((i) => i.status === "issued").reduce((a, i) => a + i.owed, 0);

  return (
    <>
      <Link href="/production/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> Clients
      </Link>
      <PageHeader
        eyebrow={`${CLIENT_KIND[c.kind]}${c.active ? "" : " · inactive"}`}
        title={c.name}
        titleDir="auto"
        subtitle={[c.contactName, c.phone, c.email, c.discountPct ? `−${c.discountPct}% on the price list` : null, `pays within ${c.paymentTermsDays} days`].filter(Boolean).join(" · ")}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-5">
          <Card title={`Cases (${cases.length})`} icon="layers" bodyClass="p-0">
            {!cases.length ? (
              <EmptyState icon="layers" title="No cases yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Status</th>
                      <th scope="col">Due / delivered</th>
                      {money && <th scope="col" className="text-right">Price</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <Link href={`/production/cases/${x.id}`} className="link font-medium">
                            {x.code}
                          </Link>
                          <div className="text-xs text-muted" dir="auto">
                            {x.type} × {x.units}
                            {x.reference ? ` · ${x.reference}` : ""}
                          </div>
                        </td>
                        <td>{CASE_STATUS[x.status]}</td>
                        <td className={x.late ? "text-danger" : ""}>{formatCairo(x.deliveredAt ?? x.dueAt, false)}</td>
                        {money && <td className="num text-right">{egp(x.priceEgp)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          {money && (
            <Card title="Invoices" icon="note" actions={<span className="text-sm">{owed ? <>owes <span className="num font-semibold">{egp(owed)}</span></> : "nothing owed"}</span>}>
              {!invs.length ? (
                <p className="text-sm text-muted">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {invs.map((i) => (
                    <li key={i.id} className={`flex items-center justify-between gap-2 py-2 ${i.status === "void" ? "opacity-60" : ""}`}>
                      <Link href={`/production/invoices/${i.id}`} className="link">
                        {i.number}
                      </Link>
                      <span className={i.overdue ? "text-danger" : "text-muted"}>
                        {i.status === "void" ? "void" : i.owed ? `${egp(i.owed)} owed${i.overdue ? ", overdue" : ""}` : "paid"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {write && ready.length > 0 && (
                <form action={createInvoiceAction} className="mt-4 grid gap-2 border-t border-line pt-3">
                  <input type="hidden" name="clientId" value={c.id} />
                  <input type="hidden" name="back" value={`/production/clients/${c.id}`} />
                  <fieldset className="grid gap-1">
                    <legend className="mb-1 text-sm font-medium">Delivered, not invoiced</legend>
                    {ready.map((r) => (
                      <label key={r.c.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="caseId" value={r.c.id} defaultChecked />
                        {caseCode(r.c.id)} · {r.type} × {r.c.units} <span className="num ml-auto">{egp(r.c.priceEgp)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="field">
                    Note on the invoice (optional)
                    <input name="notes" maxLength={2000} dir="auto" className="input input-sm" />
                  </label>
                  <button className="btn btn-primary btn-sm justify-self-start">Issue the invoice</button>
                </form>
              )}
            </Card>
          )}
          {manage && (
            <Card title="Edit" icon="edit">
              <ClientForm c={c} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
