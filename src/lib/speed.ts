import type { WorkingHours } from "./app-settings";
import { addDaysYmd, cairoLocalToDate, cairoYmd } from "./time";

export type SpeedLevel = "ok" | "amber" | "red";
export type SlaThresholds = { slaAmberMin: number; slaRedMin: number; workingHours?: WorkingHours };

// Defaults from the blueprint (target 5 minutes, red at 30). Settings can change them.
export const AMBER_AFTER_MIN = 5;
export const RED_AFTER_MIN = 30;
const DEFAULT_T: SlaThresholds = { slaAmberMin: AMBER_AFTER_MIN, slaRedMin: RED_AFTER_MIN };

const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const MAX_DAYS = 400; // a lead waiting longer than this is red whichever way you count

/**
 * Minutes between two instants. With working hours on, only minutes inside the working window
 * (Cairo wall time, on working days) count, so a lead that arrives at 02:00 is not "late" at 09:00.
 */
export function waitingMinutes(from: Date, to: Date, wh?: WorkingHours): number {
  if (to <= from) return 0;
  if (!wh?.enabled) return Math.floor((to.getTime() - from.getTime()) / 60_000);
  let ms = 0;
  let day = cairoYmd(from);
  const last = cairoYmd(to);
  for (let i = 0; i <= MAX_DAYS; i++) {
    if (wh.days.includes(weekday(day))) {
      const open = cairoLocalToDate(`${day}T${wh.start}`)!.getTime();
      const close = cairoLocalToDate(`${day}T${wh.end}`)!.getTime();
      const a = Math.max(open, from.getTime());
      const b = Math.min(close, to.getTime());
      if (b > a) ms += b - a;
    }
    if (day === last) break;
    day = addDaysYmd(day, 1);
  }
  return Math.floor(ms / 60_000);
}

export function speedLevel(minutes: number, t: SlaThresholds = DEFAULT_T): SpeedLevel {
  return minutes >= t.slaRedMin ? "red" : minutes >= t.slaAmberMin ? "amber" : "ok";
}

// Only meaningful while a lead has no first_contact_at; returns null once contacted.
export function speedBadge(
  createdAt: Date,
  firstContactAt: Date | null,
  now: Date = new Date(),
  t: SlaThresholds = DEFAULT_T,
): { minutes: number; level: SpeedLevel } | null {
  if (firstContactAt) return null;
  const minutes = Math.max(0, waitingMinutes(createdAt, now, t.workingHours));
  return { minutes, level: speedLevel(minutes, t) };
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d`;
}
