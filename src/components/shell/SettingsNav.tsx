"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "../ui/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/settings/users", label: "Users", icon: "user" },
  { href: "/settings/pipeline", label: "Stages & criteria", icon: "pipeline" },
  { href: "/settings/rules", label: "Thresholds & routing", icon: "gauge" },
  { href: "/settings/workflows", label: "Workflows", icon: "flow" },
  { href: "/settings/templates", label: "Message templates", icon: "template" },
  { href: "/settings/lists", label: "Sources & reasons", icon: "list" },
  { href: "/settings/cadences", label: "Cadences", icon: "calendar" },
  { href: "/settings/audit", label: "Audit log", icon: "history" },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${
              active ? "border-gold font-medium text-fg" : "border-transparent text-muted hover:text-fg"
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
