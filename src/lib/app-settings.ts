import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import { audit } from "./audit";

/**
 * Thresholds and switches the owner edits in Settings. Defaults are the values given in the feature
 * blueprint; nothing here is invented. Each value is validated on write.
 */
export type WorkingHours = { enabled: boolean; start: string; end: string; days: number[] }; // days: 0=Sun … 6=Sat, Cairo time
export type Route = { field: "source" | "segment"; value: string; userId: number };

export type Settings = {
  neglectDays: number; // P3: open lead with no logged activity for this many days
  staleDays: number; // P3: open lead with no stage change for this many days
  slaTargetMin: number; // C3: target minutes to first reply
  slaAmberMin: number; // badge turns amber at this many minutes waiting
  slaRedMin: number; // and red at this many
  workingHours: WorkingHours; // C3: when on, time outside these hours does not count as waiting
  decisionDueDays: number; // Today: offers with no agreed decision date count as "due" after this many days
  defaultOwnerId: number | null; // A3: owner for new leads when no route matches (null = whoever adds it)
  routes: Route[]; // A3: first matching route decides the owner
  maxOpenStages: number; // P2: warn above this many open stages
  financeSplit: { partners: { name: string; pct: number }[]; capitalPct: number }; // how net income is split
  invoiceDetails: InvoiceDetails; // who invoices and receipts are from, and how to pay
};
export type InvoiceDetails = { legalName: string; address: string; taxId: string; phone: string; email: string; paymentInstructions: string; footer: string };
const INVOICE_LIMITS: Record<keyof InvoiceDetails, number> = { legalName: 120, address: 300, taxId: 60, phone: 40, email: 120, paymentInstructions: 600, footer: 300 };

export const DEFAULTS: Settings = {
  neglectDays: 14,
  staleDays: 30,
  slaTargetMin: 5,
  slaAmberMin: 5,
  slaRedMin: 30,
  // off by default: the blueprint gives no hours, so none are assumed (QUESTIONS.md)
  workingHours: { enabled: false, start: "10:00", end: "22:00", days: [0, 1, 2, 3, 4, 6] },
  decisionDueDays: 3,
  defaultOwnerId: null,
  routes: [],
  maxOpenStages: 7,
  // from the Notion Finances page: Badr 30% · Sayyed 20% · Retro 15% · Mo 15% · Capital 20%
  financeSplit: {
    partners: [
      { name: "Badr", pct: 30 },
      { name: "Sayyed", pct: 20 },
      { name: "Retro", pct: 15 },
      { name: "Mo", pct: 15 },
    ],
    capitalPct: 20,
  },
  // only the name is known; the rest is the owners' to fill in (QUESTIONS.md)
  invoiceDetails: { legalName: "OrlaDent", address: "", taxId: "", phone: "", email: "", paymentInstructions: "", footer: "" },
};

type Key = keyof Settings;
const KEYS = Object.keys(DEFAULTS) as Key[];

const int = (min: number, max: number) => (v: unknown) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v : undefined);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const VALIDATE: { [K in Key]: (v: unknown) => Settings[K] | undefined } = {
  neglectDays: int(1, 365) as never,
  staleDays: int(1, 365) as never,
  slaTargetMin: int(1, 1440) as never,
  slaAmberMin: int(1, 1440) as never,
  slaRedMin: int(1, 10080) as never,
  decisionDueDays: int(1, 60) as never,
  maxOpenStages: int(3, 20) as never,
  defaultOwnerId: ((v: unknown) => (v === null || (Number.isInteger(v) && (v as number) > 0) ? v : undefined)) as never,
  workingHours: ((v: unknown) => {
    const w = v as WorkingHours;
    if (!w || typeof w.enabled !== "boolean" || !HHMM.test(w.start) || !HHMM.test(w.end) || w.start >= w.end) return undefined;
    if (!Array.isArray(w.days) || !w.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return undefined;
    return { enabled: w.enabled, start: w.start, end: w.end, days: [...new Set(w.days)].sort() };
  }) as never,
  financeSplit: ((v: unknown) => {
    const f = v as Settings["financeSplit"];
    if (!f || !Array.isArray(f.partners) || !f.partners.length || f.partners.length > 10) return undefined;
    const pctOk = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
    if (!pctOk(f.capitalPct) || !f.partners.every((p) => typeof p.name === "string" && p.name.trim() && p.name.length <= 40 && pctOk(p.pct))) return undefined;
    if (new Set(f.partners.map((p) => p.name.trim())).size !== f.partners.length) return undefined;
    const total = f.partners.reduce((a, p) => a + p.pct, 0) + f.capitalPct;
    if (Math.abs(total - 100) > 0.001) return undefined; // the split must account for all of net income
    return { partners: f.partners.map((p) => ({ name: p.name.trim(), pct: p.pct })), capitalPct: f.capitalPct };
  }) as never,
  invoiceDetails: ((v: unknown) => {
    const d = v as InvoiceDetails;
    if (!d || typeof d !== "object") return undefined;
    const out = {} as InvoiceDetails;
    for (const [k, max] of Object.entries(INVOICE_LIMITS) as [keyof InvoiceDetails, number][]) {
      const val = d[k] ?? "";
      if (typeof val !== "string" || val.length > max) return undefined;
      out[k] = val.trim();
    }
    return out.legalName ? out : undefined;
  }) as never,
  routes: ((v: unknown) =>
    Array.isArray(v) &&
    v.every((r) => r && (r.field === "source" || r.field === "segment") && typeof r.value === "string" && Number.isInteger(r.userId))
      ? v
      : undefined) as never,
};

export async function getSettings(db: Pick<Db, "select">): Promise<Settings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, KEYS));
  const out: Settings = structuredClone(DEFAULTS);
  for (const r of rows) {
    const k = r.key as Key;
    const v = VALIDATE[k]?.(r.value);
    if (v !== undefined) (out as Record<Key, unknown>)[k] = v;
  }
  return out;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveSettings(db: Db, patch: Partial<Settings>, actorId: number | null): Promise<SaveResult> {
  const entries = Object.entries(patch) as [Key, unknown][];
  for (const [k, v] of entries) {
    if (!(k in VALIDATE) || VALIDATE[k](v) === undefined) return { ok: false, error: `Invalid value for ${k}` };
  }
  const merged = { ...(await getSettings(db)), ...patch };
  if (merged.slaAmberMin > merged.slaRedMin) return { ok: false, error: "Amber must come before red" };
  if (merged.slaTargetMin > merged.slaRedMin) return { ok: false, error: "The target must be below the red threshold" };
  await db.transaction(async (tx) => {
    for (const [k, v] of entries) {
      // a JSON null ("no default owner"), not SQL NULL: the column is NOT NULL
      const value = (VALIDATE[k](v) ?? sql`'null'::jsonb`) as unknown;
      await tx
        .insert(appSettings)
        .values({ key: k, value, updatedBy: actorId })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedBy: actorId } });
    }
    await audit(tx, { userId: actorId, entity: "settings", action: "update", diff: { keys: entries.map(([k]) => k) } });
  });
  return { ok: true };
}

export async function getSetting<K extends Key>(db: Pick<Db, "select">, key: K): Promise<Settings[K]> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  const v = r ? VALIDATE[key](r.value) : undefined;
  return (v ?? DEFAULTS[key]) as Settings[K];
}
