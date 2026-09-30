"use client";

import { useEffect, useState } from "react";
import { saveEntryAction } from "@/app/(app)/finance/actions";
import { Icon } from "../ui/Icon";

type Section = "income" | "fixed_costs" | "variable_costs" | "partner_withdrawals";
const SECTIONS: Record<Section, { label: string; statuses: [string, string][]; categories: string[] }> = {
  income: { label: "Income", statuses: [["received", "Received"], ["expected", "Expected"]], categories: ["Candidate payment", "OrlaDent client work", "Refund"] },
  fixed_costs: { label: "Fixed cost", statuses: [["paid", "Paid"], ["owed", "Owed"]], categories: ["Salaries", "Subscriptions"] },
  variable_costs: { label: "Variable cost", statuses: [["paid", "Paid"], ["owed", "Owed"]], categories: ["Freelancers & sales", "Video production", "Content creator", "Equipment"] },
  partner_withdrawals: { label: "Partner withdrawal", statuses: [["paid", "Paid"], ["owed", "Owed"]], categories: ["Partner withdrawal"] },
};

export type EntryDraft = {
  id?: number;
  entry?: string;
  amountEgp?: number;
  date?: string;
  dateApproximate?: boolean;
  section?: Section;
  category?: string;
  status?: string;
  partner?: string | null;
  fromTo?: string | null;
  reference?: string | null;
  notes?: string | null;
  enrolmentId?: number | null;
};

/** Add or edit one ledger row in a dialog. The form posts to the server action; nothing is saved client-side. */
export function AddEntry({
  label,
  icon = "plus",
  initial,
  partners,
  candidates,
  back,
  variant = "btn btn-secondary",
}: {
  label: string;
  icon?: "plus" | "edit";
  initial?: EntryDraft;
  partners: string[];
  candidates: { id: number; name: string }[];
  back: string;
  variant?: string;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>(initial?.section ?? "income");
  const [category, setCategory] = useState(initial?.category ?? SECTIONS[initial?.section ?? "income"].categories[0]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const sec = SECTIONS[section];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={variant} aria-label={icon === "edit" ? label : undefined} title={label}>
        <Icon name={icon} size={14} />
        {icon === "plus" && label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-3 pt-[6vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={() => setOpen(false)}>
          <form
            action={saveEntryAction}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onMouseDown={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in"
          >
            <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-brand/40 bg-brand/10 text-accent">
                <Icon name="trend" />
              </span>
              <h2 className="flex-1 font-display text-xl font-semibold">{label}</h2>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-icon" aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              {initial?.id && <input type="hidden" name="id" value={initial.id} />}
              <input type="hidden" name="back" value={back} />
              <div className="col-span-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Kind">
                {(Object.keys(SECTIONS) as Section[]).map((k) => (
                  <label key={k} className={`btn btn-sm cursor-pointer ${section === k ? "btn-secondary border-brand/60" : "btn-ghost"}`}>
                    <input
                      type="radio"
                      name="section"
                      value={k}
                      checked={section === k}
                      onChange={() => {
                        setSection(k);
                        setCategory(SECTIONS[k].categories[0]);
                      }}
                      className="sr-only"
                    />
                    {SECTIONS[k].label}
                  </label>
                ))}
              </div>
              <label className="field col-span-2">
                What
                <input name="entry" required maxLength={200} defaultValue={initial?.entry} placeholder="e.g. Kero — final installment" dir="auto" className="input" />
              </label>
              <label className="field">
                Amount (EGP)
                <input name="amountEgp" required inputMode="numeric" defaultValue={initial?.amountEgp} className="input num" />
              </label>
              <label className="field">
                Status
                <select name="status" defaultValue={initial?.status ?? sec.statuses[0][0]} key={section} className="input">
                  {sec.statuses.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="field">
                Category
                <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                  {sec.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Date
                <input name="date" type="date" defaultValue={initial?.date} className="input" />
              </label>
              {section === "partner_withdrawals" && (
                <label className="field col-span-2">
                  Partner
                  <select name="partner" defaultValue={initial?.partner ?? ""} required className="input">
                    <option value="">Choose…</option>
                    {partners.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {section === "income" && category !== "OrlaDent client work" && (
                <label className="field col-span-2">
                  Candidate
                  <select name="enrolmentId" defaultValue={initial?.enrolmentId ?? ""} className="input">
                    <option value="">Not a candidate</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                From / to
                <input name="fromTo" defaultValue={initial?.fromTo ?? ""} dir="auto" className="input" />
              </label>
              <label className="field">
                Reference
                <input name="reference" defaultValue={initial?.reference ?? ""} dir="ltr" className="input" />
              </label>
              <label className="field col-span-2">
                Notes
                <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} dir="auto" className="input" />
              </label>
              <label className="col-span-2 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" name="dateApproximate" defaultChecked={initial?.dateApproximate} className="check" /> The date is approximate
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-bg/40 px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button className="btn btn-primary">{initial?.id ? "Save" : "Add"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
