import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { PrintDoc } from "@/components/finance/PrintDoc";
import { PrintButton } from "@/components/programme/PrintButton";
import { getSettings } from "@/lib/app-settings";
import { getInvoice } from "@/lib/invoices";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

// The invoice on its own page, to print or save as PDF. Owners and finance only.
export default async function InvoicePrint(props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "finance:read")) notFound();
  const inv = await getInvoice(db, Number((await props.params).id));
  if (!inv) notFound();
  const { invoiceDetails } = await getSettings(db);
  return (
    <main id="main" className="min-h-screen bg-raised/40 p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between print:hidden">
        <a href={`/production/invoices/${inv.id}`} className="link text-sm">
          Back to the invoice
        </a>
        <PrintButton />
      </div>
      <PrintDoc from={invoiceDetails} kind={inv.status === "void" ? "Invoice (void)" : "Invoice"} number={inv.number}>
        <section className="mt-6 flex flex-wrap justify-between gap-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#55556a]">Bill to</div>
            <div className="mt-1 font-medium" dir="auto">
              {inv.clientName}
            </div>
            <div className="whitespace-pre-line text-[#55556a]" dir="auto">
              {[inv.client.contactName, inv.client.address, inv.client.phone, inv.client.email].filter(Boolean).join("\n")}
            </div>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
            <dt className="text-[#55556a]">Issued</dt>
            <dd>{formatCairo(inv.issuedAt, false)}</dd>
            <dt className="text-[#55556a]">Due</dt>
            <dd>{formatCairo(inv.dueAt, false)}</dd>
          </dl>
        </section>
        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-[#e3e3ea] text-left text-xs uppercase tracking-wider text-[#55556a]">
              <th scope="col" className="py-2 pr-4 font-medium">
                Case
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Description
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.caseId} className="border-b border-[#efeff4]">
                <td className="py-2 pr-4">{l.code}</td>
                <td className="py-2 pr-4" dir="auto">
                  {l.description}
                </td>
                <td className="py-2 text-right tabular-nums">{egp(l.amountEgp)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="pt-4 text-right font-medium">
                Total
              </th>
              <td className="pt-4 text-right text-base font-semibold tabular-nums">{egp(inv.totalEgp)}</td>
            </tr>
            {inv.paid > 0 && (
              <>
                <tr>
                  <th scope="row" colSpan={2} className="pt-1 text-right font-normal text-[#55556a]">
                    Paid
                  </th>
                  <td className="pt-1 text-right tabular-nums text-[#55556a]">{egp(inv.paid)}</td>
                </tr>
                <tr>
                  <th scope="row" colSpan={2} className="pt-1 text-right font-medium">
                    Balance due
                  </th>
                  <td className="pt-1 text-right font-semibold tabular-nums">{egp(inv.owed)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
        {inv.notes && (
          <p className="mt-6 whitespace-pre-line text-sm" dir="auto">
            {inv.notes}
          </p>
        )}
      </PrintDoc>
    </main>
  );
}
