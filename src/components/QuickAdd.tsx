"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { quickAddLead, type QuickAddState } from "@/app/(app)/leads/actions";
import { Icon } from "./ui/Icon";
import { OPEN_QUICK_ADD, isTyping } from "./shell/events";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn btn-primary">
      {pending ? "Adding…" : "Add lead"}
      {!pending && <kbd className="rounded bg-white/20 px-1 text-[10px] font-semibold">↵</kbd>}
    </button>
  );
}

export function QuickAdd({ sources }: { sources: { id: number; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<QuickAddState, FormData>(quickAddLead, {});
  const nameRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  // The dialog lives in the layout, so it survives the redirect to the new lead: close it on navigation.
  useEffect(() => setOpen(false), [pathname]);

  // "n" opens quick add (ignored while typing in a field), Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "n" && !isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_QUICK_ADD, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_QUICK_ADD, show);
    };
  }, []);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary max-sm:w-9 max-sm:px-0" title="Quick add (N)" aria-label="New lead">
        <Icon name="plus" />
        <span className="hidden sm:inline">New lead</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-3 pt-[10vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={() => setOpen(false)}>
          <form
            action={action}
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Quick add lead"
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in"
          >
            <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
            <div className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-brand/40 bg-brand/10 text-accent">
                <Icon name="bolt" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-semibold leading-tight">New lead</h2>
                <p className="text-xs text-muted">The clock starts now: aim to reply within 5 minutes.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-icon -mr-2 -mt-1" aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <label className="field">
                Name
                <input ref={nameRef} name="fullName" required dir="auto" autoComplete="off" className="input h-10 text-[15px]" />
              </label>
              <label className="field">
                WhatsApp number
                <input name="phone" type="tel" inputMode="tel" dir="ltr" placeholder="010… or +20…" autoComplete="off" className="input h-10 text-[15px]" />
              </label>
              <label className="field">
                Source
                <select name="sourceId" defaultValue="" className="input">
                  <option value="">Not set</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {state?.error && (
                <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {state?.error}
                  {state?.duplicates?.map((d) => (
                    <div key={d.id} className="mt-1">
                      <Link href={`/leads/${d.id}`} className="font-medium underline" onClick={() => setOpen(false)}>
                        Open {d.fullName}
                      </Link>{" "}
                      <span className="opacity-80">
                        (same {d.matchedOn}
                        {d.deleted ? ", deleted: restore from its page" : ""})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line bg-bg/40 px-5 py-3">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost">
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
