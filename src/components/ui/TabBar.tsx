"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";

export type Tab = { href: string; label: string; icon?: IconName; count?: number; active: boolean };

/** The underlined tab row. It scrolls sideways when the tabs outgrow the screen and keeps the current one in view. */
export function TabBar({ items, label }: { items: Tab[]; label: string }) {
  const nav = useRef<HTMLElement>(null);
  const current = items.find((t) => t.active)?.href;
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && nav.current) nav.current.scrollLeft = Math.max(0, el.offsetLeft - nav.current.clientWidth / 2 + el.clientWidth / 2);
  }, [current]);
  return (
    <nav ref={nav} aria-label={label} className="relative mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`relative -mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition ${
            t.active ? "border-brand font-medium text-fg" : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {t.icon && <Icon name={t.icon} size={14} className={t.active ? "text-accent" : ""} />}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
