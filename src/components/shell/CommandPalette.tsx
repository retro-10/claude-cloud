"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { Icon, type IconName } from "../ui/Icon";
import { OPEN_PALETTE, OPEN_QUICK_ADD, OPEN_SHORTCUTS, emit } from "./events";
import { currentTheme, setTheme } from "./theme";

type Hit = { kind: string; id: number; label: string; sub: string; href: string };
type Recent = { href: string; label: string; kind: string };
const RECENT_KEY = "hq:palette-recent";
const ICON: Record<string, IconName> = {
  Leads: "user",
  Batches: "cohorts",
  Tasks: "list",
  Docs: "note",
  Campaigns: "target",
  Content: "sparkle",
  Chat: "chat",
  Approvals: "check",
  People: "user",
  Announcements: "send",
  "Brand assets": "layers",
};

// Recent destinations live in this browser only: a convenience, so a failure to read or write is ignored.
function readRecent(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
  } catch {
    return [];
  }
}
function remember(r: Recent) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...readRecent().filter((x) => x.href !== r.href)].slice(0, 6)));
  } catch {
    /* private window or storage blocked */
  }
}
type Command = { id: string; group: string; label: string; icon: IconName; hint?: string; keywords?: string; run: () => void };
export type PaletteLink = { href: string; label: string; icon: IconName; keys?: string; group?: string; keywords?: string };

// Fuzzy-enough matching: every word of the query must appear somewhere in the label or keywords.
const matches = (q: string, text: string) => {
  const t = text.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w));
};

export function CommandPalette({ links, actions = [], canWrite }: { links: PaletteLink[]; actions?: PaletteLink[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    restoreFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const show = () => {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener(OPEN_PALETTE, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_PALETTE, show);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Lead search: debounced, and a newer query cancels the older request.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) setHits(((await res.json()) as { hits: Hit[] }).hits);
      } catch {
        /* aborted or offline: keep the command list usable */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [...actions.map((a) => ({ ...a, group: a.group ?? "Actions" })), ...links].map((l) => ({
      id: `go:${l.href}`,
      group: l.group ?? "Go to",
      label: l.label,
      icon: l.icon,
      hint: l.keys,
      keywords: l.keywords,
      run: () => go(l.href),
    }));
    if (canWrite)
      list.unshift({
        id: "new-lead",
        group: "Actions",
        label: "New lead",
        icon: "plus",
        hint: "N",
        keywords: "add create quick",
        run: () => {
          close();
          setTimeout(() => emit(OPEN_QUICK_ADD), 0);
        },
      });
    list.push(
      {
        id: "theme",
        group: "Actions",
        label: "Switch light / dark theme",
        icon: "moon",
        keywords: "appearance dark light mode",
        run: () => {
          setTheme(currentTheme() === "dark" ? "light" : "dark");
          close();
        },
      },
      {
        id: "shortcuts",
        group: "Actions",
        label: "Keyboard shortcuts",
        icon: "keyboard",
        hint: "?",
        keywords: "help keys",
        run: () => {
          close();
          setTimeout(() => emit(OPEN_SHORTCUTS), 0);
        },
      },
      { id: "logout", group: "Actions", label: "Sign out", icon: "logout", keywords: "log out exit", run: () => void logout() },
    );
    return list;
  }, [links, actions, canWrite, go, close]);

  const shown = useMemo(() => {
    const term = q.trim();
    const cmds = term ? commands.filter((c) => matches(term, `${c.label} ${c.keywords ?? ""} ${c.group}`)) : commands;
    const open = (h: { href: string; label: string; kind: string }) => {
      remember({ href: h.href, label: h.label, kind: h.kind });
      go(h.href);
    };
    const records: Command[] = hits.map((h) => ({
      id: `${h.kind}:${h.id}`,
      group: h.kind,
      label: h.label,
      icon: ICON[h.kind] ?? "search",
      hint: h.sub,
      run: () => open(h),
    }));
    // records first when something is typed; with nothing typed, where you went last, then commands
    if (term) return [...records, ...cmds];
    const recents: Command[] = recent.map((r) => ({ id: `recent:${r.href}`, group: "Recent", label: r.label, icon: ICON[r.kind] ?? "history", hint: r.kind, run: () => open(r) }));
    return [...recents, ...cmds];
  }, [q, commands, hits, go, recent]);

  useEffect(() => setActive(0), [q, hits.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const groups = shown.reduce<{ name: string; items: { c: Command; i: number }[] }[]>((acc, c, i) => {
    const g = acc.find((x) => x.name === c.group) ?? acc[acc.push({ name: c.group, items: [] }) - 1];
    g.items.push({ c, i });
    return acc;
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      shown[active]?.run();
    } else if (e.key === "Tab") {
      e.preventDefault(); // keep focus inside the dialog
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 p-3 pt-[12vh] backdrop-blur-[2px] animate-fade-in" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, tasks, docs, campaigns… or type a command"
            dir="auto"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            aria-label="Search records or commands"
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />}
          <kbd className="kbd">Esc</kbd>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
          {shown.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">{loading ? "Searching…" : `Nothing matches “${q.trim()}”.`}</p>
          )}
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-1">
              <div aria-hidden className="eyebrow px-3 pb-1 pt-2">
                {g.name}
              </div>
              {g.items.map(({ c, i }) => (
                <div
                  key={c.id}
                  id={`${listId}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    i === active ? "bg-raised text-fg shadow-[inset_2px_0_0_rgb(var(--brand))]" : "text-fg/90"
                  }`}
                >
                  <Icon name={c.icon} className={i === active ? "text-accent" : "text-muted"} />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {c.label}
                  </span>
                  {c.hint && <span className="text-xs text-muted">{c.hint}</span>}
                  {i === active && <Icon name="arrowRight" size={14} className="text-muted" />}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-bg/40 px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> move
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd> open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="kbd">Ctrl</kbd>
            <kbd className="kbd">K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
