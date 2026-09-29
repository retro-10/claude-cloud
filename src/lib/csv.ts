// Minimal RFC 4180 CSV. UTF-8 only; a leading BOM is stripped.

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // drop fully empty lines
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Spreadsheet formula injection: a cell starting with = @ tab CR (or +/- that isn't a plain number
// or phone) can run as a formula when the export is opened in Excel. Prefix those with an apostrophe.
export function safeCell(value: string): string {
  if (/^[=@\t\r]/.test(value)) return "'" + value;
  if (/^[+-]/.test(value) && !/^[+-]?[\d\s().-]+$/.test(value)) return "'" + value;
  return value;
}

// Inverse of safeCell, applied on import so an exported file round-trips.
export function unsafeCell(value: string): string {
  return /^'[=@+\-\t\r]/.test(value) ? value.slice(1) : value;
}

function quote(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows
    .map((r) => r.map((v) => quote(safeCell(v === null || v === undefined ? "" : String(v)))).join(","))
    .join("\r\n");
  return "﻿" + body + "\r\n"; // BOM so Excel reads Arabic as UTF-8
}
