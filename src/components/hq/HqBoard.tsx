"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { moveTaskAction } from "@/app/(app)/hq/actions";
import type { SpaceStatus } from "@/lib/hq";
import { Icon } from "../ui/Icon";

export type BoardCard = {
  id: number;
  title: string;
  status: string;
  priority: string;
  listName: string;
  assignee: string | null;
  due: string | null; // formatted
  overdue: boolean;
  subtasks: number;
  subtasksDone: number;
  tags: string[];
  position: number;
};

const colorVar = (c: string) => `rgb(var(--c-${c}, var(--c-slate)))`;
const PRIORITY_COLOR: Record<string, string> = { urgent: "danger", high: "warn", low: "slate" };
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

/**
 * The kanban board: one column per status. Drag a card to another column to change its status (a Done column
 * finishes it). Each column ends with an add-task row that starts the task in that status.
 */
export function HqBoard({ statuses, cards: initial, canWrite, showList, addForms }: {
  statuses: SpaceStatus[];
  cards: BoardCard[];
  canWrite: boolean;
  showList: boolean;
  addForms?: Record<string, React.ReactNode>; // the add-task row for each status, rendered on the server
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCards(initial), [initial]);

  /** Moves a card to another status: optimistic, put back if the server says no. */
  function move(id: number, status: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === status) return;
    const position = Math.max(0, ...cards.filter((c) => c.status === status).map((c) => c.position)) + 1;
    const before = cards;
    setCards(cards.map((c) => (c.id === id ? { ...c, status, position } : c)));
    setError(null);
    start(async () => {
      const r = await moveTaskAction({ id, status, position });
      if (!r.ok) {
        setCards(before);
        setError(r.error);
      } else router.refresh();
    });
  }

  function drop(status: string) {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (id !== null) move(id, status);
  }

  return (
    <div className="board-wide">
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-6 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        {statuses.map((s) => {
          const col = cards.filter((c) => c.status === s.key).sort((a, b) => a.position - b.position || a.id - b.id);
          return (
            <section
              key={s.key}
              aria-label={`${s.label}, ${col.length} tasks`}
              onDragOver={(e) => {
                if (!canWrite || drag === null) return;
                e.preventDefault();
                setOver(s.key);
              }}
              onDragLeave={() => setOver((o) => (o === s.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(s.key);
              }}
              className={`flex w-[248px] shrink-0 snap-start flex-col rounded-2xl border bg-surface/50 transition ${
                over === s.key ? "border-brand/70 bg-brand/5" : "border-line"
              }`}
            >
              <header className="flex items-center gap-2 border-b border-line px-3 py-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorVar(s.color) }} aria-hidden />
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em]">{s.label}</h3>
                <span className="count ml-auto">{col.length}</span>
              </header>
              <ul className="flex min-h-[80px] flex-col gap-2 p-2">
                {col.map((c) => (
                  <li
                    key={c.id}
                    draggable={canWrite}
                    onDragStart={(e) => {
                      setDrag(c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    className={`group rounded-xl border border-line bg-surface p-3 shadow-soft transition hover:border-brand/40 hover:shadow-lift ${
                      drag === c.id ? "opacity-50" : ""
                    } ${canWrite ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    {showList && <div className="mb-1 truncate text-[11px] text-muted">{c.listName}</div>}
                    <Link href={`/tasks/${c.id}`} className="block text-sm font-medium leading-snug hover:text-accent">
                      {c.title}
                    </Link>
                    {c.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.tags.map((t) => (
                          <span key={t} className="rounded bg-raised px-1.5 py-0.5 text-[11px] text-muted">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                      {c.assignee ? (
                        <span className="grid h-6 w-6 place-items-center rounded-full border border-brand/40 bg-raised text-[10px] font-semibold text-accent" title={c.assignee}>
                          {initials(c.assignee)}
                        </span>
                      ) : (
                        <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-line" title="Nobody yet">
                          <Icon name="user" size={12} />
                        </span>
                      )}
                      {c.due && <span className={c.overdue ? "font-medium text-danger" : ""}>{c.due}</span>}
                      {PRIORITY_COLOR[c.priority] && (
                        <span title={`${c.priority} priority`} className="inline-flex">
                          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill={colorVar(PRIORITY_COLOR[c.priority])}>
                            <path d="M5 22V15M5 15s1-1 4-1 5 2 8 2 3-1 3-1V3s-1 1-3 1-5-2-8-2-4 1-4 1v12Z" />
                          </svg>
                          <span className="sr-only">{c.priority} priority</span>
                        </span>
                      )}
                      {c.subtasks > 0 && (
                        <span className="inline-flex items-center gap-1" title="Subtasks done">
                          <Icon name="list" size={12} />
                          {c.subtasksDone}/{c.subtasks}
                        </span>
                      )}
                      {canWrite && (
                        <select
                          aria-label={`Move ${c.title} to`}
                          value={c.status}
                          onChange={(e) => move(c.id, e.target.value)}
                          className="input input-xs ml-auto h-7 w-auto max-w-[110px] border-transparent bg-transparent text-[11px] shadow-none hover:border-line"
                        >
                          {statuses.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {canWrite && addForms?.[s.key] && <div className="mt-auto border-t border-line p-2">{addForms[s.key]}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
