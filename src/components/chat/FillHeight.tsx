"use client";

import { useLayoutEffect, useRef } from "react";

// Chat fills the screen from where it starts down to the bottom (above the phone's bottom bar), whatever banners
// sit above it, so the message box is always in view and only the messages scroll.
export function FillHeight({ className, children }: { className: string; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const box = el.current;
      if (!box) return;
      const bar = document.querySelector<HTMLElement>('nav[aria-label="Quick"]');
      const below = bar && getComputedStyle(bar).display !== "none" ? bar.offsetHeight : 0;
      const top = box.getBoundingClientRect().top + window.scrollY;
      box.style.height = `${Math.max(420, window.innerHeight - top - below - 16)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div ref={el} className={className}>
      {children}
    </div>
  );
}
