"use client";

import Link from "next/link";
import { useTransition } from "react";
import { markNotificationsReadAction } from "@/app/(app)/leads/actions";
import { Popover } from "../crm/Popover";
import { Icon } from "../ui/Icon";

export type BellItem = { id: number; title: string; leadId: number | null; at: string; unread: boolean };

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

// N1: in-app notifications created by workflow rules (new lead, overdue, unanswered lead).
export function NotificationBell({ items, unread }: { items: BellItem[]; unread: number }) {
  const [busy, start] = useTransition();
  return (
    <Popover
      className="btn btn-ghost btn-icon relative"
      title="Notifications"
      label={
        <>
          <Icon name="inbox" size={18} />
          <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ""}</span>
          {unread > 0 && (
            <span aria-hidden className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-onbrand">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </>
      }
    >
      <div className="w-80 max-w-[85vw]">
        <div className="flex items-center justify-between px-2.5 pb-2 pt-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => start(() => markNotificationsReadAction())}>
              Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-2.5 pb-4 pt-2 text-sm text-muted">Nothing yet. Rules post here when a lead needs you.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.leadId ? `/leads/${n.leadId}` : "/"}
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-raised"
                >
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.unread ? "bg-brand" : "bg-line"}`} />
                  <span className="min-w-0 flex-1" dir="auto">
                    {n.title}
                  </span>
                  <span className="num text-xs text-muted">{ago(n.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
