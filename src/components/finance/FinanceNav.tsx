"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "../ui/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/finance", label: "Overview", icon: "dashboard" },
  { href: "/finance/candidates", label: "Candidates", icon: "leads" },
  { href: "/finance/ledger", label: "Ledger", icon: "list" },
];

export function FinanceNav() {
  const path = usePathname();
  const month = useSearchParams().get("month");
  return (
    <nav aria-label="Finance sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={month ? `${t.href}?month=${month}` : t.href}
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
