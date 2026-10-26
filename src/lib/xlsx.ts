import { inflateRawSync } from "node:zlib";

// Reads the cell values of an Excel workbook (.xlsx): enough to import a ledger, no dependency. An .xlsx file is a
// zip of XML parts; this reads the zip's central directory, inflates the parts it needs, and takes each cell's
// stored value (for a formula, the value Excel last calculated). Sizes are capped so a crafted file cannot exhaust
// memory.

const MAX_FILE = 10 * 1024 * 1024; // 10 MB upload
const MAX_PART = 30 * 1024 * 1024; // one inflated XML part
const MAX_ENTRIES = 2000;

export type Cell = string | number | boolean | null;
export type Sheet = { name: string; rows: Map<number, Map<string, Cell>> }; // row number -> column letters -> value

export class XlsxError extends Error {}

function unzip(buf: Buffer): Map<string, () => Buffer> {
  if (buf.length > MAX_FILE) throw new XlsxError("The file is larger than 10 MB");
  // the end-of-central-directory record sits in the last 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("This is not an .xlsx file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError("The file has too many parts");
  const out = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("The file is damaged");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, () => {
      if (usize > MAX_PART) throw new XlsxError("A part of the file is too large");
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxError("The file is damaged");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART });
      throw new XlsxError("The file uses an unsupported compression");
    });
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** The text of every <t> inside a fragment (shared strings can be split into rich-text runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export function readXlsx(buf: Buffer): Sheet[] {
  const zip = unzip(buf);
  const part = (path: string) => {
    const f = zip.get(path);
    return f ? f().toString("utf8") : null;
  };
  const workbook = part("xl/workbook.xml");
  if (!workbook) throw new XlsxError("This is not an .xlsx workbook");
  const rels = part("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id") ?? "", attr(m[0], "Target") ?? ""]));
  const shared = [...(part("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decode(attr(m[0], "name") ?? "");
    const rid = attr(m[0], "r:id") ?? "";
    let path = target.get(rid) ?? "";
    path = path.startsWith("/") ? path.slice(1) : `xl/${path}`;
    const xml = part(path);
    if (!xml) continue;
    const rows = new Map<number, Map<string, Cell>>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[0], "r");
      const ma = ref && /^([A-Z]+)(\d+)$/.exec(ref);
      if (!ma) continue;
      const t = attr(c[0], "t");
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (t === "s") value = v != null ? (shared[Number(v)] ?? null) : null;
      else if (t === "inlineStr") value = texts(body);
      else if (t === "str") value = v != null ? decode(v) : null;
      else if (t === "b") value = v === "1";
      else if (t === "e") value = null;
      else if (v != null && v !== "") value = Number(v);
      if (value === null || value === "") continue;
      const r = Number(ma[2]);
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r)!.set(ma[1], value);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
