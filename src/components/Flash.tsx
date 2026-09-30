"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";

// Result feedback for pages whose forms redirect back with ?notice=… or ?error=…
// A notice is a toast that fades after a few seconds; an error stays inline until the next action.
export function Flash({ notice, error }: { notice?: string; error?: string }) {
  const [shown, setShown] = useState(notice);
  useEffect(() => {
    setShown(notice);
    if (!notice) return;
    const t = setTimeout(() => setShown(undefined), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (error)
    return (
      <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger animate-rise-in">
        <Icon name="alert" className="mt-0.5" />
        <span>{error}</span>
      </p>
    );
  if (!shown) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[55] flex justify-center px-4 sm:bottom-6 sm:justify-end">
      <p
        role="status"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-sm shadow-lift animate-toast-in"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
          <Icon name="check" size={14} />
        </span>
        <span className="min-w-0 flex-1">{shown}</span>
        <button onClick={() => setShown(undefined)} className="btn btn-ghost btn-sm -mr-1 w-7 px-0" aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </p>
    </div>
  );
}
