export const IMPORT_FIELDS = [
  "fullName",
  "phone",
  "email",
  "city",
  "segment",
  "source",
  "tierInterest",
  "stage",
  "notes",
  "createdAt",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  fullName: "Name",
  phone: "WhatsApp / phone",
  email: "Email",
  city: "City",
  segment: "Segment",
  source: "Source",
  tierInterest: "Tier interest",
  stage: "Stage",
  notes: "Notes",
  createdAt: "Created date",
};

const HEADER_HINTS: Record<ImportField, RegExp> = {
  fullName: /^(full[\s_-]*name|name|task[\s_-]*name|الاسم|اسم)$/i,
  phone: /(phone|whats\s*app|mobile|tel|رقم|موبايل|واتس)/i,
  email: /(e-?mail|بريد)/i,
  city: /^(city|location|مدينة|المدينة)$/i,
  segment: /^segment$/i,
  source: /^(source|lead[\s_-]*source|المصدر)$/i,
  tierInterest: /(tier|package|interest)/i,
  stage: /^(stage|status|الحالة)$/i,
  notes: /(notes?|comments?|description|ملاحظات)/i,
  createdAt: /(created|date[\s_-]*created|تاريخ)/i,
};

// Suggest a column for each field from the header names. Each column is used at most once.
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const used = new Set<number>();
  const out: Partial<Record<ImportField, number>> = {};
  for (const f of IMPORT_FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && HEADER_HINTS[f].test(h.trim()));
    if (i >= 0) {
      out[f] = i;
      used.add(i);
    }
  }
  return out;
}

export const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"] as const;
export const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"] as const;
export const slug = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
export const pick = <T extends string>(list: readonly T[], v?: string): T | null => (v && list.find((x) => x === slug(v))) || null;

// Accepts ISO, ClickUp epoch milliseconds, and day-first dates (dd/mm/yyyy [hh:mm]) as used in Egypt.
export function parseDate(v?: string): Date | null {
  const s = v?.trim();
  if (!s) return null;
  if (/^\d{12,13}$/.test(s)) return new Date(Number(s));
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0)));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

