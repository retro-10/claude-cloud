import Link from "next/link";
import type { SpaceStatus } from "@/lib/hq";
import { formatCairo } from "@/lib/time";
import { Icon, type IconName } from "../ui/Icon";

// Server-safe HQ building blocks: colour dots, status pills, priority flags, the view switcher.

export const colorVar = (c: string) => `rgb(var(--c-${c}, var(--c-slate)))`;

export function Dot({ color, size = 8, ring = false }: { color: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={ring ? { width: size, height: size, boxShadow: `inset 0 0 0 2px ${colorVar(color)}` } : { width: size, height: size, background: colorVar(color) }}
    />
  );
}

export function StatusPill({ status }: { status: SpaceStatus | undefined }) {
  if (!status) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-raised/70 px-2 py-0.5 text-xs font-medium">
      <Dot color={status.color} ring={status.group === "todo"} />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

const PRIORITY: Record<string, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "danger" },
  high: { label: "High", color: "warn" },
  normal: { label: "Normal", color: "info" },
  low: { label: "Low", color: "slate" },
};

export function PriorityFlag({ priority, showNormal = false }: { priority: string; showNormal?: boolean }) {
  if (priority === "normal" && !showNormal) return null;
  const p = PRIORITY[priority] ?? PRIORITY.normal;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${p.label} priority`}>
      <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill={colorVar(p.color)} stroke={colorVar(p.color)} strokeWidth="1.8">
        <path d="M5 22V15M5 15s1-1 4-1 5 2 8 2 3-1 3-1V3s-1 1-3 1-5-2-8-2-4 1-4 1v12Z" />
      </svg>
      {p.label}
    </span>
  );
}

export function SpaceBadge({ color, icon, size = 28 }: { color: string; icon: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-lg text-white"
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${colorVar(color)}, rgb(var(--c-${color}) / 0.65))` }}
    >
      <Icon name={icon as IconName} size={Math.round(size * 0.55)} />
    </span>
  );
}

/** "Today", "Tomorrow", "Mon 26 Oct" — the due date as people say it, red when late. */
export function DueDate({ due, overdue, done }: { due: Date | null; overdue?: boolean; done?: boolean }) {
  if (!due) return <span className="text-xs text-faint">—</span>;
  const day = formatCairo(due, false);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${overdue && !done ? "font-medium text-danger" : "text-muted"}`}>
      <Icon name="calendar" size={12} />
      {day}
    </span>
  );
}

export type ViewKey = "list" | "board" | "calendar" | "table";
export const VIEWS: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: "list", label: "List", icon: "list" },
  { key: "board", label: "Board", icon: "pipeline" },
  { key: "calendar", label: "Calendar", icon: "calendar" },
  { key: "table", label: "Table", icon: "layers" },
];

export function ViewTabs({ current, href }: { current: ViewKey; href: (v: ViewKey) => string }) {
  return (
    <nav aria-label="Views" className="flex items-center gap-1 overflow-x-auto">
      {VIEWS.map((v) => {
        const active = v.key === current;
        return (
          <Link
            key={v.key}
            href={href(v.key)}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
              active ? "bg-raised font-medium text-fg shadow-soft" : "text-muted hover:bg-raised/60 hover:text-fg"
            }`}
          >
            <Icon name={v.icon} size={15} className={active ? "text-accent" : ""} />
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
