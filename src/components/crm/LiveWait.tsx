"use client";

import { useEffect, useState } from "react";
import type { WorkingHours } from "@/lib/app-settings";
import { formatMinutes, speedLevel, waitingMinutes } from "@/lib/speed";

const TONE = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  amber: "border-warn/40 bg-warn/10 text-warn",
  red: "border-danger/40 bg-danger/10 text-danger",
} as const;

/**
 * C3: a live "waiting" timer for someone waiting on us. Colour follows the SLA thresholds in Settings;
 * with working hours on, nights and days off do not count. Re-renders every 20 seconds.
 */
export function LiveWait({
  since,
  amber,
  red,
  workingHours,
  label = "waiting",
}: {
  since: string;
  amber: number;
  red: number;
  workingHours?: WorkingHours;
  label?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  const m = waitingMinutes(new Date(since), now, workingHours);
  const level = speedLevel(m, { slaAmberMin: amber, slaRedMin: red });
  return (
    <span className={`chip num ${TONE[level]}`} title={`Waiting ${m} minutes${workingHours?.enabled ? " (working hours only)" : ""}`} suppressHydrationWarning>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${level === "red" ? "animate-pulse-ring" : ""}`} aria-hidden />
      {formatMinutes(m)} {label}
    </span>
  );
}
