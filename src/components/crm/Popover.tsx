"use client";

import { useEffect, useRef } from "react";

/**
 * A small menu built on <details>: works without JavaScript, and with it closes on outside click,
 * Escape, or after a form inside it is submitted.
 */
export function Popover({
  label,
  children,
  className = "btn btn-secondary btn-sm",
  align = "right",
  title,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  title?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    const submitted = () => setTimeout(() => (el.open = false), 0);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    el.addEventListener("submit", submitted);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      el.removeEventListener("submit", submitted);
    };
  }, []);
  return (
    <details ref={ref} className="group relative">
      <summary className={`${className} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} title={title}>
        {label}
      </summary>
      <div
        className={`absolute top-full z-30 mt-1.5 min-w-[13rem] rounded-xl border border-line bg-surface p-1.5 shadow-lift animate-pop-in ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </div>
    </details>
  );
}

export const menuItem = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg hover:bg-raised";
