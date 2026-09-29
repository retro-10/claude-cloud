"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { quickAddLead, type QuickAddState } from "@/app/(app)/leads/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded bg-gold px-3 py-2 font-medium text-ink disabled:opacity-60">
      {pending ? "Adding…" : "Add lead"}
    </button>
  );
}

export function QuickAdd({ sources }: { sources: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState<QuickAddState, FormData>(quickAddLead, {});
  const nameRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  // The dialog lives in the layout, so it survives the redirect to the new lead: close it on navigation.
  useEffect(() => setOpen(false), [pathname]);

  // "n" opens quick add (ignored while typing in a field), Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink" title="Quick add (n)">
        + Lead
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
          <form
            action={action}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Quick add lead"
            className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-surface p-4"
          >
            <h2 className="font-display text-xl">New lead</h2>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input ref={nameRef} name="fullName" required dir="auto" className="rounded border border-line bg-bg px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              WhatsApp number
              <input name="phone" type="tel" inputMode="tel" dir="ltr" placeholder="010… or +20…" className="rounded border border-line bg-bg px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Source
              <select name="sourceId" defaultValue="" className="rounded border border-line bg-bg px-3 py-2">
                <option value="">—</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {state?.error && (
              <div role="alert" className="text-sm text-red-500">
                {state?.error}
                {state?.duplicates?.map((d) => (
                  <div key={d.id} className="mt-1">
                    <Link href={`/leads/${d.id}`} className="underline" onClick={() => setOpen(false)}>
                      Open {d.fullName}
                    </Link>{" "}
                    <span className="text-muted">
                      (same {d.matchedOn}
                      {d.deleted ? ", deleted: restore from its page" : ""})
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-muted">
                Cancel
              </button>
              <Submit />
            </div>
          </form>
        </div>
      )}
    </>
  );
}
