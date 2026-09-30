// Client-safe helpers (no DB imports).

export type Rate = { num: number; den: number; pct: number | null; small: boolean };

export const SMALL_SAMPLE = 5; // fewer than this many records: show the raw count, not a percentage

export function rate(num: number, den: number): Rate {
  return { num, den, pct: den > 0 ? (num / den) * 100 : null, small: den < SMALL_SAMPLE };
}

/** "72.2%", or "3 of 4" when there are fewer than 5 records, or "–" with no records at all. */
export function fmtRate(r: Rate): string {
  if (r.den === 0) return "–";
  return r.small ? `${r.num} of ${r.den}` : `${r.pct!.toFixed(1)}%`;
}

export function fmtMinutes(m: number | null): string {
  if (m === null) return "–";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 60 * 48) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

export const fmtDays = (d: number | null) => (d === null ? "–" : `${d.toFixed(1)} days`);
export const fmtEgp = (n: number) => `${n.toLocaleString("en-US")} EGP`;
