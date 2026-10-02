import type { InvoiceDetails } from "@/lib/app-settings";

/** The letterhead and footer shared by invoices and receipts: always light, A4-friendly, prints as it shows. */
export function PrintDoc({ from, kind, number, children }: { from: InvoiceDetails; kind: string; number: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-[800px] rounded-xl bg-white p-10 text-[#1a1a24] shadow-xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e3e3ea] pb-6">
        <div>
          <div className="text-xl font-semibold" dir="auto">
            {from.legalName}
          </div>
          <div className="mt-1 whitespace-pre-line text-sm text-[#55556a]" dir="auto">
            {[from.address, from.phone, from.email].filter(Boolean).join("\n")}
          </div>
          {from.taxId && <div className="mt-1 text-sm text-[#55556a]">Tax registration no. {from.taxId}</div>}
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#55556a]">{kind}</div>
          <div className="mt-1 text-lg font-semibold">{number}</div>
        </div>
      </header>
      {children}
      {(from.paymentInstructions || from.footer) && (
        <footer className="mt-10 border-t border-[#e3e3ea] pt-4 text-sm text-[#55556a]">
          {from.paymentInstructions && (
            <p className="whitespace-pre-line" dir="auto">
              <span className="font-medium text-[#1a1a24]">How to pay: </span>
              {from.paymentInstructions}
            </p>
          )}
          {from.footer && (
            <p className="mt-2" dir="auto">
              {from.footer}
            </p>
          )}
        </footer>
      )}
    </article>
  );
}
