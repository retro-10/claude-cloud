import { daysUntilCairo } from "./time";

export function closeLabel(closeAt: Date | null, now: Date = new Date()): string {
  if (!closeAt) return "No close date";
  const d = daysUntilCairo(closeAt, now);
  return d < 0 ? `Closed ${-d}d ago` : d === 0 ? "Closes today" : `Closes in ${d}d`;
}

export const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;
