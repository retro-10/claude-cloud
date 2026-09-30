import Link from "next/link";
import { Icon, type IconName } from "./Icon";

export { Icon, type IconName };

// Server-safe building blocks (no hooks). Visual language: charcoal surfaces, hairline borders, one indigo accent.

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  titleDir,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  titleDir?: "auto";
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 animate-rise-in">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="page-title" dir={titleDir}>
          {title}
        </h1>
        {subtitle && <div className="mt-1.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  icon,
  actions,
  children,
  className = "",
  bodyClass = "p-4",
  as: Tag = "section",
  label,
}: {
  title?: React.ReactNode;
  icon?: IconName;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
  as?: "section" | "div";
  label?: string;
}) {
  return (
    <Tag className={`card ${className}`} aria-label={label}>
      {title && (
        <div className="card-head">
          <h2 className="card-title flex items-center gap-2">
            {icon && <Icon name={icon} className="text-accent" />}
            {title}
          </h2>
          {actions}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </Tag>
  );
}

export function EmptyState({ icon = "sparkle", title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full border border-line bg-raised text-accent">
        <Icon name={icon} size={18} />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-xs text-xs text-muted">{children}</div>}
    </div>
  );
}

// Initials on a neutral disc with a hairline in the accent: identity without adding colours to the palette.
export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      className="inline-grid shrink-0 place-items-center rounded-full border border-brand/35 bg-gradient-to-br from-raised to-surface font-semibold text-accent"
    >
      {initials || "?"}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconName;
  tone?: "brand";
}) {
  return (
    <div className={`card relative overflow-hidden p-4 ${tone === "brand" ? "border-brand/40" : ""}`}>
      {tone === "brand" && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted">{label}</div>
        {icon && <Icon name={icon} className="text-muted" />}
      </div>
      <div className="num mt-2 font-display text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Tabs({ items, current }: { items: { href: string; label: string; count?: number }[]; current: string }) {
  return (
    <nav aria-label="Sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((t) => {
        const active = current === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${
              active ? "border-brand font-medium text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t.label}
            {t.count !== undefined && <span className="count">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export const pretty = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "");

export function StageChip({ label, kind }: { label: string; kind?: string | null }) {
  const cls = kind === "won" ? "chip chip-ok" : kind === "lost" ? "chip chip-danger" : kind === "nurture" ? "chip" : "chip chip-brand";
  return <span className={cls}>{label}</span>;
}
