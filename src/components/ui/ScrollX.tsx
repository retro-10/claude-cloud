"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A wide table's horizontal scroller. While its content is wider than the screen it becomes a labelled,
 * focusable region, so keyboard users can scroll it too (WCAG scrollable-region-focusable); otherwise it adds
 * no extra tab stop.
 */
export function ScrollX({ label = "Table", className = "", children }: { label?: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`overflow-x-auto ${className}`} {...(over ? { tabIndex: 0, role: "region", "aria-label": `${label} (scrolls sideways)` } : {})}>
      {children}
    </div>
  );
}
