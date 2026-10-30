"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { clockInAction, clockOutAction, endAuxAction, startAuxAction } from "@/app/(app)/calendar/actions";
import { Icon } from "../ui/Icon";

/** "2h 05m", ticking: the time since a clock-in. */
export function LiveDuration({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const m = Math.max(0, Math.floor(((now ?? new Date(since).getTime()) - new Date(since).getTime()) / 60_000));
  return (
    <span className="tabular-nums">
      {Math.floor(m / 60)}h {String(m % 60).padStart(2, "0")}m
    </span>
  );
}

/** Where a clock form sends the person back to: the page they are on, without an old notice or error. */
function useBack() {
  const path = usePathname();
  const sp = new URLSearchParams(useSearchParams().toString());
  sp.delete("notice");
  sp.delete("error");
  const q = sp.toString();
  return q ? `${path}?${q}` : path;
}

export type ClockProps = {
  running: boolean;
  since: string | null;
  aux: { label: string; since: string } | null; // the away status running now
  codes: { key: string; label: string }[]; // the away statuses to pick from
};

/**
 * The top bar's clock: one click to start work, one to stop. While working it shows how long it has run, and a
 * menu to step away (break, prayer, lunch …). While away it shows the status and how long, with "Back".
 */
export function ClockButton({ running, since, aux, codes }: ClockProps) {
  const back = useBack();
  if (running && since && aux)
    return (
      <div className="flex items-center gap-1">
        <span role="status" className="btn btn-sm pointer-events-none gap-2 border border-warn/40 bg-warn/10 text-warn">
          <span aria-hidden className="h-2 w-2 rounded-full bg-warn" />
          <span className="max-w-[7rem] truncate">{aux.label}</span>
          <LiveDuration since={aux.since} />
        </span>
        <form action={endAuxAction}>
          <input type="hidden" name="back" value={back} />
          <button className="btn btn-secondary btn-sm" title="End the break and go back to work">
            Back<span className="sr-only"> to work</span>
          </button>
        </form>
      </div>
    );
  if (running && since)
    return (
      <div className="flex items-center gap-1">
        <form action={clockOutAction} className="flex items-center">
          <input type="hidden" name="back" value={back} />
          <button className="btn btn-sm gap-2 border border-ok/40 bg-ok/10 text-ok hover:bg-ok/20" title="You are clocked in. Click to clock out.">
            <span aria-hidden className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            <span className="hidden sm:inline">Working</span>
            <LiveDuration since={since} />
            <span className="sr-only">. Clock out</span>
            <Icon name="x" size={13} className="hidden sm:block" />
          </button>
        </form>
        {codes.length > 0 && (
          <details className="relative">
            <summary className="btn btn-secondary btn-sm list-none" title="Step away: break, prayer, lunch">
              <Icon name="snooze" size={14} />
              <span className="hidden md:inline">Away</span>
              <span className="sr-only md:hidden">Step away</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-48 rounded-xl border border-line bg-surface p-1 shadow-lg">
              {codes.map((c) => (
                <form key={c.key} action={startAuxAction}>
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="code" value={c.key} />
                  <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-raised">{c.label}</button>
                </form>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  return (
    <form action={clockInAction}>
      <input type="hidden" name="back" value={back} />
      <button className="btn btn-secondary btn-sm" title="Start your working time">
        <Icon name="clock" size={15} />
        <span className="hidden sm:inline">Clock in</span>
        <span className="sr-only sm:hidden">Clock in</span>
      </button>
    </form>
  );
}
