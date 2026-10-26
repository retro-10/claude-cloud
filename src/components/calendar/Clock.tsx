"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { clockInAction, clockOutAction } from "@/app/(app)/calendar/actions";
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

/** The top bar's clock: one click to start work, one to stop. While working it shows how long it has run. */
export function ClockButton({ running, since }: { running: boolean; since: string | null }) {
  const back = useBack();
  if (running && since)
    return (
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
