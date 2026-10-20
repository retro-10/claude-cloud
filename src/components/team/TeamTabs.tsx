import { Tabs } from "@/components/ui";

export function TeamTabs({ current }: { current: string }) {
  return (
    <Tabs
      label="Team and operations"
      current={current}
      items={[
        { href: "/team", label: "Responsibilities" },
        { href: "/team/sops", label: "Playbooks" },
        { href: "/team/runs", label: "Checklists" },
        { href: "/team/meetings", label: "Meetings" },
        { href: "/team/decisions", label: "Decisions" },
      ]}
    />
  );
}
