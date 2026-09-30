"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { OPEN_PALETTE, OPEN_SHORTCUTS, emit, isTyping } from "./events";

export type GoKey = { key: string; href: string; label: string };

/**
 * Global single-key shortcuts (never while typing in a field):
 *   /        focus the page's search box (id="search"), or open the palette if the page has none
 *   g then t/l/p/c/d/s   go to a page
 *   ?        this help
 * Ctrl/Cmd+K lives in the palette, "n" in quick add.
 */
export function Shortcuts({ goKeys, canWrite }: { goKeys: GoKey[]; canWrite: boolean }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const pendingG = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = goKeys.find((g) => g.key === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
      } else if (e.key === "/") {
        e.preventDefault();
        const el = document.getElementById("search");
        if (el) el.focus();
        else emit(OPEN_PALETTE);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      }
    };
    const open = () => setHelp(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS, open);
    };
  }, [goKeys, router]);

  useEffect(() => {
    if (!help) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  if (!help) return null;
  const rows: [string[], string][] = [
    [["Ctrl", "K"], "Search leads and run any command"],
    [["/"], "Focus this page's search box"],
    ...(canWrite ? ([[["N"], "New lead"]] as [string[], string][]) : []),
    ...goKeys.map((g) => [["G", g.key.toUpperCase()], `Go to ${g.label}`] as [string[], string]),
    [["?"], "Show this help"],
    [["Esc"], "Close a dialog"],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-3 pt-[12vh] animate-fade-in" onMouseDown={() => setHelp(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-pop animate-pop-in"
      >
        <div className="mb-4 flex items-center gap-2">
          <Icon name="keyboard" className="text-accent" />
          <h2 id="shortcuts-title" className="font-display text-xl font-semibold">
            Keyboard shortcuts
          </h2>
          <button ref={closeRef} onClick={() => setHelp(false)} className="btn btn-ghost btn-icon ml-auto" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <dl className="divide-y divide-line">
          {rows.map(([keys, what]) => (
            <div key={what} className="flex items-center justify-between gap-4 py-2 text-sm">
              <dt className="text-muted">{what}</dt>
              <dd className="flex gap-1">
                {keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
