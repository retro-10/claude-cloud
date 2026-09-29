export type SpeedLevel = "ok" | "amber" | "red";

export const AMBER_AFTER_MIN = 5;
export const RED_AFTER_MIN = 30;

// Only meaningful while a lead has no first_contact_at; returns null once contacted.
export function speedBadge(
  createdAt: Date,
  firstContactAt: Date | null,
  now: Date = new Date(),
): { minutes: number; level: SpeedLevel } | null {
  if (firstContactAt) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000));
  const level: SpeedLevel = minutes >= RED_AFTER_MIN ? "red" : minutes >= AMBER_AFTER_MIN ? "amber" : "ok";
  return { minutes, level };
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d`;
}
