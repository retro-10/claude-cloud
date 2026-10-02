import { and, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { cohorts, enrolments, invoices, leads, ledgerEntries } from "@/db/schema";
import { PrintDoc } from "@/components/finance/PrintDoc";
import { PrintButton } from "@/components/programme/PrintButton";
import { getSettings } from "@/lib/app-settings";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

// A receipt for money received: a student's payment or a client's, straight from its ledger row. Owners and finance.
export default async function ReceiptPrint(props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "finance:read")) notFound();
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [r] = await db
    .select({ e: ledgerEntries, student: leads.fullName, batch: cohorts.name, invoice: invoices.number, client: invoices.clientName })
    .from(ledgerEntries)
    .leftJoin(enrolments, eq(enrolments.id, ledgerEntries.enrolmentId))
    .leftJoin(leads, eq(leads.id, enrolments.leadId))
    .leftJoin(cohorts, eq(cohorts.id, enrolments.cohortId))
    .leftJoin(invoices, eq(invoices.id, ledgerEntries.invoiceId))
    .where(and(eq(ledgerEntries.id, id), isNull(ledgerEntries.deletedAt)));
  // only money that came in, and was not a refund
  if (!r || r.e.section !== "income" || r.e.status !== "received" || r.e.category === "Refund") notFound();
  const { invoiceDetails } = await getSettings(db);
  const from = r.student ?? r.client ?? r.e.fromTo ?? "—";
  const what = r.invoice ? `Payment on invoice ${r.invoice}` : r.batch ? `OrlaDent Camp, ${r.batch}` : r.e.category;
  const back = r.invoice ? `/production/invoices/${r.e.invoiceId}` : "/finance/ledger";
  return (
    <main id="main" className="min-h-screen bg-raised/40 p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between print:hidden">
        <a href={back} className="link text-sm">
          Back
        </a>
        <PrintButton />
      </div>
      <PrintDoc from={invoiceDetails} kind="Receipt" number={`R-${String(r.e.id).padStart(6, "0")}`}>
        <dl className="mt-8 grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
          <dt className="text-[#55556a]">Received from</dt>
          <dd className="font-medium" dir="auto">
            {from}
          </dd>
          <dt className="text-[#55556a]">For</dt>
          <dd dir="auto">{what}</dd>
          <dt className="text-[#55556a]">Date</dt>
          <dd>{formatCairo(r.e.date ?? r.e.createdAt, false)}</dd>
          {r.e.reference && (
            <>
              <dt className="text-[#55556a]">Reference</dt>
              <dd>{r.e.reference}</dd>
            </>
          )}
          <dt className="text-[#55556a]">Amount</dt>
          <dd className="text-2xl font-semibold tabular-nums">{r.e.amountEgp.toLocaleString("en-US")} EGP</dd>
        </dl>
        <p className="mt-10 text-sm text-[#55556a]">With thanks.</p>
      </PrintDoc>
    </main>
  );
}
