"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/login/actions";
import { QuickAdd } from "../QuickAdd";
import { ThemeToggle } from "../ThemeToggle";
import { Icon, type IconName } from "../ui/Icon";
import { CommandPalette, type PaletteLink } from "./CommandPalette";
import { OPEN_PALETTE, OPEN_QUICK_ADD, emit } from "./events";
import { Shortcuts, type GoKey } from "./Shortcuts";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  section: string;
  count?: number;
  alert?: boolean; // count shown in the attention colour
  keys?: string; // "G T"
  exact?: boolean;
};

type Props = {
  user: { name: string; role: string };
  nav: NavItem[];
  canWrite: boolean;
  sources: { id: number; label: string }[];
  goKeys: GoKey[];
  children: React.ReactNode;
};

function isActive(pathname: string, item: NavItem) {
  const [path, query] = item.href.split("?");
  if (query) return false; // views are highlighted by their own page
  return item.exact ? pathname === path : pathname === path || pathname.startsWith(path + "/");
}

function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-3 rounded-lg px-2 py-1" aria-label="OrlaDent Camp CRM, go to Today">
      <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-gold/50 bg-gradient-to-br from-[#2a2415] via-[#17150f] to-[#0c0c0b] shadow-glow">
        <span className="font-display text-lg font-semibold leading-none text-gold">O</span>
        <span aria-hidden className="absolute inset-x-1 top-0 h-px bg-gradient-to-r from-transparent via-gold-soft/80 to-transparent" />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[17px] font-semibold tracking-tight">OrlaDent</span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">Camp CRM</span>
      </span>
    </Link>
  );
}

function NavList({ nav, pathname, onNavigate }: { nav: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const sections = nav.reduce<string[]>((a, n) => (a.includes(n.section) ? a : [...a, n.section]), []);
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {sections.map((s) => (
        <div key={s}>
          <div className="eyebrow mb-1.5 px-3">{s}</div>
          <ul className="flex flex-col gap-0.5">
            {nav
              .filter((n) => n.section === s)
              .map((n) => {
                const active = isActive(pathname, n);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={n.keys ? `${n.label} (${n.keys})` : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active ? "bg-raised font-medium text-fg" : "text-muted hover:bg-raised/60 hover:text-fg"
                      }`}
                    >
                      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gold" />}
                      <Icon name={n.icon} size={17} className={active ? "text-accent" : "text-muted group-hover:text-fg"} />
                      <span className="min-w-0 flex-1 truncate">{n.label}</span>
                      {n.count !== undefined && n.count > 0 && (
                        <span className={n.alert ? "count bg-danger/15 text-danger" : "count"} aria-label={`${n.count} items`}>
                          {n.count > 99 ? "99+" : n.count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ user }: { user: Props["user"] }) {
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface/70 p-2">
      <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-raised" title="My account">
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/40 bg-raised text-xs font-semibold text-accent">
          {initials}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-[11px] capitalize text-muted">{user.role}</span>
        </span>
      </Link>
      <form action={logout}>
        <button className="btn btn-ghost btn-icon" aria-label="Sign out" title="Sign out">
          <Icon name="logout" />
        </button>
      </form>
    </div>
  );
}

export function AppFrame({ user, nav, canWrite, sources, goKeys, children }: Props) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const links: PaletteLink[] = nav.map((n) => ({
    href: n.href,
    label: n.section === "Views" ? `View: ${n.label}` : n.label,
    icon: n.icon,
    keys: n.keys,
    group: n.section === "Views" ? "Smart views" : "Go to",
  }));
  links.push({ href: "/account", label: "My account", icon: "user", keywords: "password profile" });
  if (canWrite) links.push({ href: "/leads/import", label: "Import leads from CSV", icon: "upload", group: "Actions", keywords: "upload spreadsheet" });

  const current = nav.find((n) => isActive(pathname, n));
  const mobileTabs = nav.filter((n) => ["/", "/leads", "/pipeline"].includes(n.href));

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/60 backdrop-blur-xl lg:flex">
        <div className="px-4 pb-4 pt-5">
          <Brand />
        </div>
        <div className="px-4 pb-4">
          <button
            onClick={() => emit(OPEN_PALETTE)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg/70 px-3 text-sm text-muted transition hover:border-gold/50 hover:text-fg"
          >
            <Icon name="search" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavList nav={nav} pathname={pathname} />
        </div>
        <div className="border-t border-line p-3">
          <UserCard user={user} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/55 animate-fade-in" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col border-r border-line bg-surface shadow-pop animate-rise-in">
            <div className="flex items-center justify-between px-4 pb-3 pt-4">
              <Brand />
              <button onClick={() => setDrawer(false)} className="btn btn-ghost btn-icon" aria-label="Close menu">
                <Icon name="x" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <NavList nav={nav} pathname={pathname} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-line p-3">
              <UserCard user={user} />
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-6">
          <button onClick={() => setDrawer(true)} className="btn btn-ghost btn-icon -ml-2 lg:hidden" aria-label="Open menu">
            <Icon name="menu" size={18} />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">OrlaDent Camp</span>
            <Icon name="chevronRight" size={14} className="hidden text-faint sm:block" />
            <span className="truncate font-medium">{current?.label ?? "CRM"}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => emit(OPEN_PALETTE)} className="btn btn-ghost btn-icon lg:hidden" aria-label="Search">
              <Icon name="search" size={18} />
            </button>
            <button onClick={() => emit(OPEN_PALETTE)} className="btn btn-ghost hidden lg:inline-flex" title="Command palette (Ctrl K)">
              <Icon name="command" />
              <span className="text-xs">Commands</span>
            </button>
            <ThemeToggle />
            {canWrite && <QuickAdd sources={sources} />}
          </div>
        </div>
      </header>

      {children}

      {/* Mobile bottom bar: the things a seller reaches for with a thumb */}
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-5">
          {mobileTabs.map((n) => {
            const active = isActive(pathname, n);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
                <Icon name={n.icon} size={20} />
                {n.label}
                {!!n.count && <span aria-hidden className="absolute right-[26%] top-1.5 h-2 w-2 rounded-full bg-gold" />}
              </Link>
            );
          })}
          {canWrite ? (
            <button onClick={() => emit(OPEN_QUICK_ADD)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gold text-ink">
                <Icon name="plus" size={16} />
              </span>
              Add
            </button>
          ) : (
            <span />
          )}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted">
            <Icon name="menu" size={20} />
            More
          </button>
        </div>
      </nav>

      <CommandPalette links={links} canWrite={canWrite} />
      <Shortcuts goKeys={goKeys} canWrite={canWrite} />
    </div>
  );
}
