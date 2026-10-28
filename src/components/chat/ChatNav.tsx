"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Icon } from "../ui";

export type NavConversation = { id: number; kind: "channel" | "dm"; title: string; unread: number };

/** The conversation list beside the chat. Unread counts follow the open conversation's poll. */
export function ChatNav({ channels, dms, current }: { channels: NavConversation[]; dms: NavConversation[]; current: number | null }) {
  const router = useRouter();
  const [unread, setUnread] = useState<Record<string, number>>({});
  const known = [...channels, ...dms].map((c) => c.id).join(",");
  useEffect(() => {
    const ids = new Set(known.split(",").map(Number));
    const on = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, number>>).detail;
      setUnread(detail);
      // someone started a DM with me, or a channel I am in appeared: fetch the list again
      if (Object.keys(detail).some((id) => !ids.has(Number(id)))) router.refresh();
    };
    window.addEventListener("chat:unread", on);
    return () => window.removeEventListener("chat:unread", on);
  }, [known, router]);

  const item = (c: NavConversation) => {
    const n = c.id === current ? 0 : (unread[c.id] ?? c.unread);
    return (
      <li key={c.id}>
        <Link
          href={`/chat/${c.id}`}
          aria-current={c.id === current ? "page" : undefined}
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${c.id === current ? "bg-brand/15 font-medium text-fg" : n ? "font-semibold text-fg hover:bg-raised" : "text-muted hover:bg-raised hover:text-fg"}`}
        >
          {c.kind === "channel" ? (
            <span aria-hidden className="w-5 text-center text-muted">
              #
            </span>
          ) : (
            <Avatar name={c.title} size={20} />
          )}
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
          {n > 0 && (
            <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-5 text-onbrand">
              {n > 99 ? "99+" : n}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Conversations" className="flex flex-col gap-5 p-3">
      <Link href="/chat/new" className="btn btn-primary btn-sm w-full">
        <Icon name="plus" size={14} /> New message or channel
      </Link>
      <div>
        <h2 className="mb-1 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted">Channels</h2>
        <ul className="flex flex-col gap-0.5">{channels.map(item)}</ul>
        <Link href="/chat/new?tab=browse" className="mt-1 block px-2.5 py-1 text-xs text-muted hover:text-fg">
          Browse channels
        </Link>
      </div>
      <div>
        <h2 className="mb-1 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted">Direct messages</h2>
        {dms.length ? <ul className="flex flex-col gap-0.5">{dms.map(item)}</ul> : <p className="px-2.5 text-xs text-muted">None yet.</p>}
      </div>
    </nav>
  );
}
