"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { IconName } from "../ui/Icon";
import { TabBar } from "../ui/TabBar";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/finance", label: "Overview", icon: "dashboard" },
  { href: "/finance/candidates", label: "Candidates", icon: "leads" },
  { href: "/finance/ledger", label: "Ledger", icon: "list" },
  { href: "/finance/budget", label: "Budget", icon: "target" },
  { href: "/finance/forecast", label: "Cash forecast", icon: "trend" },
  { href: "/finance/economics", label: "Unit economics", icon: "gauge" },
];

export function FinanceNav() {
  const path = usePathname();
  const month = useSearchParams().get("month");
  return (
    <TabBar
      label="Finance sections"
      items={TABS.map((t) => ({ ...t, href: month ? `${t.href}?month=${month}` : t.href, active: path === t.href }))}
    />
  );
}
