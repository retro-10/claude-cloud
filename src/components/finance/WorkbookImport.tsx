"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { importWorkbookAction, previewWorkbookAction } from "@/app/(app)/finance/rebuild/actions";
import type { WorkbookPreview } from "@/lib/workbook-import";
import { Icon } from "../ui/Icon";

const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} EGP`;
const SECTION: Record<string, string> = { income: "Income", fixed_costs: "Fixed cost", variable_costs: "Variable cost", partner_withdrawals: "Withdrawal" };

/**
 * Import the partners' Cycle Close workbook: choose the file, check the preview against the workbook's own cash
 * figures, choose what to take (ledger, rules, functions), then import. Nothing is written before the last step.
 */
export function WorkbookImport({ owner, defaultDate, closeDate }: { owner: boolean; defaultDate: string; closeDate: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ added: number; archived: number; skipped: number; functions: number } | null>(null);
  const [opts, setOpts] = useState({ date: defaultDate, closeDate: closeDate ?? "", replaceLedger: true, model: owner, functions: owner });
  const [pending, start] = useTransition();

  const form = () => {
    const f = new FormData();
    if (file) f.set("file", file);
    f.set("date", opts.date);
    if (opts.closeDate) f.set("closeDate", opts.closeDate);
    if (opts.replaceLedger) f.set("replaceLedger", "on");
    if (opts.model) f.set("model", "on");
    if (opts.functions) f.set("functions", "on");
    return f;
  };

  function onPreview() {
    setError("");
    setDone(null);
    start(async () => {
      const r = await previewWorkbookAction(form());
      if (r.ok) setPreview(r.preview);
      else {
        setPreview(null);
        setError(r.error);
      }
    });
  }

  function onImport() {
    setError("");
    start(async () => {
      const r = await importWorkbookAction(form());
      if (r.ok) setDone(r);
      else setError(r.error);
    });
  }

  const t = preview?.totals;
  const match = preview && preview.workbookCash.today !== null ? Math.round(t!.cashToday) === Math.round(preview.workbookCash.today) && Math.round(t!.cashAtClose) === Math.round(preview.workbookCash.atClose ?? Number.NaN) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="card p-5" aria-labelledby="wb-step1">
        <h2 id="wb-step1" className="card-title mb-3">
          1. Choose the workbook
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="field flex-1">
            Cycle Close workbook (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setDone(null);
              }}
              className="input input-sm py-1.5"
            />
          </label>
          <button type="button" onClick={onPreview} disabled={!file || pending} className="btn btn-secondary btn-sm">
            <Icon name="eye" size={14} /> {pending && !preview ? "Reading…" : "Preview"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">It reads the sheets Ledger, Assumptions, Function Owners and Salaries. Nothing is saved until you import.</p>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {preview && t && (
        <section className="card" aria-labelledby="wb-step2">
          <h2 id="wb-step2" className="card-title border-b border-line px-5 py-4">
            2. Check it
          </h2>
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Income</div>
              <div className="font-semibold tabular-nums">{egp(t.campIncome + t.coreIncome)}</div>
              <div className="text-xs text-muted">
                Camp {egp(t.campIncome)} · Core {egp(t.coreIncome)}
              </div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="text-xs text-muted">Out</div>
              <div className="font-semibold tabular-nums">{egp(t.costs + t.withdrawals)}</div>
              <div className="text-xs text-muted">
                Costs {egp(t.costs)} · Withdrawals {egp(t.withdrawals)}
              </div>
            </div>
            <div className={`rounded-xl border p-4 ${match === false ? "border-danger/50" : match ? "border-ok/50" : "border-line"}`}>
              <div className="text-xs text-muted">Cash today / at the close</div>
              <div className="font-semibold tabular-nums">
                {egp(t.cashToday)} / {egp(t.cashAtClose)}
              </div>
              <div className={`text-xs ${match === false ? "text-danger" : match ? "text-ok" : "text-muted"}`}>
                {match === null
                  ? "The workbook's own figures were not found to compare"
                  : match
                    ? "Matches the workbook's Cycle Position"
                    : `The workbook says ${egp(preview.workbookCash.today ?? 0)} / ${egp(preview.workbookCash.atClose ?? 0)}`}
              </div>
            </div>
          </div>
          <div className="max-h-[360px] overflow-auto border-y border-line" role="region" aria-label="Rows to import" tabIndex={0}>
            <table className="table min-w-[720px]">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Item</th>
                  <th scope="col">Goes to</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.ledger.map((d) => (
                  <tr key={d.row}>
                    <td className="text-muted tabular-nums">{d.row}</td>
                    <td>
                      {d.entry}
                      <span className="block text-xs text-muted">{d.source}</span>
                    </td>
                    <td className="text-sm">
                      {SECTION[d.section]} · {d.category}
                      {d.partner && ` · ${d.partner}`}
                      <span className="block text-xs text-muted">{d.stream === "core" ? "Core" : "Camp"}</span>
                    </td>
                    <td className="capitalize">{d.status}</td>
                    <td className="text-right tabular-nums">{egp(d.amountEgp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <p className="px-5 pt-3 text-sm text-warn">
              Skipped: {preview.skipped.map((s) => `row ${s.row} (${s.reason})`).join(", ")}
            </p>
          )}
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <div className="text-sm">
              <h3 className="mb-1 font-medium">Rules read from Assumptions</h3>
              {preview.model ? (
                <ul className="list-disc space-y-0.5 pl-5 text-muted">
                  <li>
                    Old Camp split: {preview.campSplit?.partners.map((p) => `${p.name} ${p.pct}%`).join(", ")}, Capital {preview.campSplit?.capitalPct}%
                  </li>
                  <li>
                    Old Core split: {preview.model.coreSplit.partners.map((p) => `${p.name} ${p.pct}%`).join(", ")}, Capital {preview.model.coreSplit.capitalPct}%
                  </li>
                  <li>New shares: {preview.model.newShares.map((p) => `${p.name} ${p.pct}%`).join(", ")}</li>
                  <li>Fixed costs: {egp(preview.model.fixedCosts.reduce((a, f) => a + f.amount, 0))} a month ({preview.model.fixedCosts.length} lines)</li>
                  <li>Pay pools: {preview.model.tiers.map((x) => egp(x.pool)).join(" · ")}</li>
                </ul>
              ) : (
                <p className="text-muted">No Assumptions sheet: the current rules stay.</p>
              )}
            </div>
            <div className="text-sm">
              <h3 className="mb-1 font-medium">Functions</h3>
              <p className="text-muted">{preview.functions.length ? `${preview.functions.length} lines with their accountable and supporting partners.` : "No Function Owners sheet."}</p>
            </div>
          </div>
        </section>
      )}

      {preview && (
        <section className="card p-5" aria-labelledby="wb-step3">
          <h2 id="wb-step3" className="card-title mb-3">
            3. Import
          </h2>
          <div className="flex flex-col gap-3">
            <label className={`field sm:w-60 ${owner ? "" : "opacity-60"}`}>
              Cycle close date
              <input type="date" value={opts.closeDate} disabled={!owner} onChange={(e) => setOpts({ ...opts, closeDate: e.target.value })} className="input input-sm" />
              <span className="text-xs font-normal">Money up to the end of this day belongs to the old cycle.{!owner && " Owners only."}</span>
            </label>
            <label className="field sm:w-60">
              Date for the imported rows
              <input type="date" value={opts.date} onChange={(e) => setOpts({ ...opts, date: e.target.value })} className="input input-sm" />
              <span className="text-xs font-normal">The workbook has no dates. Rows are marked as approximate; keep it on or before the close date.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={opts.replaceLedger} onChange={(e) => setOpts({ ...opts, replaceLedger: e.target.checked })} className="check mt-0.5" />
              <span>
                <strong className="font-medium">Replace the old cycle&apos;s ledger.</strong> Archives every row dated up to the close date first, so the workbook&apos;s corrected numbers are the only ones. Archived
                rows stay in the database and the audit log.
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${owner ? "" : "opacity-60"}`}>
              <input type="checkbox" checked={opts.model} disabled={!owner || !preview.model} onChange={(e) => setOpts({ ...opts, model: e.target.checked })} className="check mt-0.5" />
              <span>
                <strong className="font-medium">Take the rules</strong> (splits, new shares, fixed costs, pay pools, multipliers).{!owner && " Owners only."}
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${owner ? "" : "opacity-60"}`}>
              <input type="checkbox" checked={opts.functions} disabled={!owner || !preview.functions.length} onChange={(e) => setOpts({ ...opts, functions: e.target.checked })} className="check mt-0.5" />
              <span>
                <strong className="font-medium">Take the functions table</strong> (replaces the current one).{!owner && " Owners only."}
              </span>
            </label>
            <div>
              <button type="button" onClick={onImport} disabled={pending || !!done} className="btn btn-primary btn-sm">
                <Icon name="upload" size={14} /> {pending ? "Importing…" : "Import"}
              </button>
            </div>
            {done && (
              <p role="status" className="rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">
                Imported {done.added} rows{done.archived ? `, archived ${done.archived} old rows` : ""}
                {done.skipped ? `, ${done.skipped} already there` : ""}
                {done.functions ? `, ${done.functions} functions` : ""}.{" "}
                <Link href="/finance/cycle" className="font-medium underline">
                  See the cycle close
                </Link>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
