"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "../ui/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/settings/users", label: "Users", icon: "user" },
  { href: "/settings/pipeline", label: "Stages & criteria", icon: "pipeline" },
  { href: "/settings/targets", label: "Targets", icon: "target" },
  { href: "/settings/rules", label: "Thresholds & routing", icon: "gauge" },
  { href: "/settings/workflows", label: "Workflows", icon: "flow" },
  { href: "/settings/templates", label: "Message templates", icon: "template" },
  { href: "/settings/lists", label: "Sources & reasons", icon: "list" },
  { href: "/settings/cadences", label: "Cadences", icon: "calendar" },
  { href: "/settings/finance", label: "Finance split", icon: "trend" },
  { href: "/settings/team", label: "Team", icon: "user" },
  { href: "/settings/integrations", label: "Integrations", icon: "layers" },
  { href: "/settings/audit", label: "Audit log", icon: "history" },
];

export function SettingsNav() {
  const path = usePathname();
  const nav = useRef<HTMLElement>(null);
  // ten tabs overflow a laptop screen: keep the current one in view
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && nav.current) nav.current.scrollLeft = Math.max(0, el.offsetLeft - nav.current.clientWidth / 2 + el.clientWidth / 2);
  }, [path]);
  return (
    <nav ref={nav} aria-label="Settings sections" className="relative mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${
              active ? "border-brand font-medium text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            <Icon name={t.icon} size={14} className={active ? "text-accent" : ""} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
