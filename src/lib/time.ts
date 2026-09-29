export const TZ = "Africa/Cairo";

export function formatCairo(d: Date | null | undefined, withTime = true): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

// "2026-09-29T14:30" from a <input type="datetime-local"> is Cairo wall time -> UTC Date.
export function cairoLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0"] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  // Cairo's offset at that instant (handles DST)
  const offset = cairoOffsetMs(new Date(asUtc));
  return new Date(asUtc - offset);
}

function cairoOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime();
}

// ---- Cairo calendar-day helpers ("today", "overdue" and cadence dates are Cairo days) ----

/** "2026-09-29" for the Cairo calendar date of an instant. */
export function cairoYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Add whole days to a YYYY-MM-DD string (pure calendar arithmetic, no time zone involved). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Instant at which the Cairo day containing `d` began. */
export function startOfCairoDay(d: Date = new Date()): Date {
  return cairoLocalToDate(`${cairoYmd(d)}T00:00`)!;
}

/** Instant at which the next Cairo day begins. */
export function startOfNextCairoDay(d: Date = new Date()): Date {
  return cairoLocalToDate(`${addDaysYmd(cairoYmd(d), 1)}T00:00`)!;
}

/** Default time of day (Cairo) for follow-ups created from a date alone. */
export const FOLLOW_UP_HOUR = "09:00";
export function followUpDue(ymd: string): Date | null {
  return cairoLocalToDate(`${ymd}T${FOLLOW_UP_HOUR}`);
}
