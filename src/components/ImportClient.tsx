"use client";

import { useMemo, useState, useTransition } from "react";
import { runImport, type ImportResult } from "@/app/(app)/leads/import/actions";
import { parseCsv } from "@/lib/csv";
import { FIELD_LABELS, IMPORT_FIELDS, guessMapping, type ImportField, type ImportRow } from "@/lib/import-fields";
import { normalizePhone } from "@/lib/phone";

const sel = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

export function ImportClient() {
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const headers = table?.[0] ?? [];
  const body = useMemo(() => table?.slice(1) ?? [], [table]);

  const rows: ImportRow[] = useMemo(
    () =>
      body.map((r) => {
        const o: ImportRow = {};
        for (const f of IMPORT_FIELDS) {
          const idx = mapping[f];
          if (idx !== undefined && r[idx] !== undefined) o[f] = r[idx];
        }
        return o;
      }),
    [body, mapping],
  );

  async function onFile(file: File | undefined) {
    setResult(null);
    if (!file) return;
    const parsed = parseCsv(await file.text());
    setFileName(file.name);
    setTable(parsed);
    setMapping(guessMapping(parsed[0] ?? []));
  }

  const go = (dryRun: boolean) =>
    start(async () => {
      setResult(await runImport({ rows, updateExisting, dryRun }));
    });

  const hasKey = mapping.phone !== undefined || mapping.email !== undefined;

  return (
    <div className="flex flex-col gap-4">
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => onFile(e.target.files?.[0])}
        aria-label="CSV file"
        className="text-sm"
      />

      {table && (
        <>
          <p className="text-sm text-muted">
            {fileName}: {body.length} rows. Match each field to a column; leave blank to skip.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1 text-xs text-muted">
                {FIELD_LABELS[f]}
                <select
                  className={sel}
                  value={mapping[f] ?? ""}
                  onChange={(e) => {
                    setResult(null);
                    setMapping((m) => {
                      const n = { ...m };
                      if (e.target.value === "") delete n[f];
                      else n[f] = Number(e.target.value);
                      return n;
                    });
                  }}
                >
                  <option value="">— skip —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {!hasKey && (
            <p role="alert" className="text-sm text-warn">
              Map a phone or email column so duplicates can be detected. Without one, re-importing the same file would create duplicates.
            </p>
          )}

          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="bg-surface uppercase text-muted">
                <tr>
                  {IMPORT_FIELDS.filter((f) => mapping[f] !== undefined).map((f) => (
                    <th key={f} className="px-2 py-1">
                      {FIELD_LABELS[f]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {IMPORT_FIELDS.filter((f) => mapping[f] !== undefined).map((f) => (
                      <td key={f} className="px-2 py-1" dir="auto">
                        {f === "phone" && r.phone ? (normalizePhone(r.phone) ?? <span className="text-danger">invalid: {r.phone}</span>) : r[f]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
            Fill in blank fields on people who already exist (never overwrites)
          </label>

          <div className="flex gap-2">
            <button disabled={pending || !rows.length} onClick={() => go(true)} className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-60">
              {pending ? "Working…" : "Preview (saves nothing)"}
            </button>
            <button disabled={pending || !rows.length} onClick={() => go(false)} className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60">
              Import {body.length} rows
            </button>
          </div>
        </>
      )}

      {result && !result.ok && (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <div className="rounded border border-line bg-surface p-3 text-sm" role="status">
          <p className="font-medium">{result.dryRun ? "Preview (nothing saved)" : "Import complete"}</p>
          <p>
            Created {result.report.created} · Updated {result.report.updated} · Skipped {result.report.skipped}
            {result.report.warnings > 0 && ` · ${result.report.warnings} value warnings (unknown source/stage, bad date or email, left blank)`}
          </p>
          {result.report.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-muted">
              {result.report.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
