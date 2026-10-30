"use client";

import { usePathname } from "next/navigation";
import type { IconName } from "../ui/Icon";
import { TabBar } from "../ui/TabBar";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/settings/users", label: "Users", icon: "user" },
  { href: "/settings/pipeline", label: "Stages & criteria", icon: "pipeline" },
  { href: "/settings/targets", label: "Targets", icon: "target" },
  { href: "/settings/rules", label: "Thresholds & routing", icon: "gauge" },
  { href: "/settings/workflows", label: "Workflows", icon: "flow" },
  { href: "/settings/templates", label: "Message templates", icon: "template" },
  { href: "/settings/lists", label: "Sources & reasons", icon: "list" },
  { href: "/settings/cadences", label: "Cadences", icon: "calendar" },
  { href: "/settings/finance", label: "Finance & pay rules", icon: "trend" },
  { href: "/settings/team", label: "Team", icon: "user" },
  { href: "/settings/time", label: "Time & away", icon: "snooze" },
  { href: "/settings/approvals", label: "Approvals", icon: "check" },
  { href: "/settings/ai", label: "AI assistant", icon: "sparkle" },
  { href: "/settings/integrations", label: "Integrations", icon: "layers" },
  { href: "/settings/audit", label: "Audit log", icon: "history" },
];

export function SettingsNav() {
  const path = usePathname();
  return <TabBar label="Settings sections" items={TABS.map((t) => ({ ...t, active: path === t.href }))} />;
}
