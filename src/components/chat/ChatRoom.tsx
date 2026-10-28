"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteMessageAction, editMessageAction, sendMessageAction } from "@/app/(app)/chat/actions";
import { ChatText } from "../hq/Markdown";
import { Avatar, Icon } from "../ui";

export type RoomMessage = { id: number; userId: number; author: string; body: string; createdAt: string; editedAt: string | null; deleted: boolean; pending?: boolean };
export type RoomPerson = { id: number; name: string };

const POLL_VISIBLE = 3000;
const POLL_HIDDEN = 20000;
const GROUP_MS = 5 * 60_000;
const MAX = 4000;

const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });
const ymd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));

function dayLabel(iso: string) {
  const d = ymd(iso);
  if (d === ymd(new Date().toISOString())) return "Today";
  if (d === ymd(new Date(Date.now() - 86_400_000).toISOString())) return "Yesterday";
  return day.format(new Date(iso));
}

/** Merge changed rows into the list by id, oldest first. */
function merge(list: RoomMessage[], changed: RoomMessage[]): RoomMessage[] {
  if (!changed.length) return list;
  const byId = new Map(list.filter((m) => !m.pending).map((m) => [m.id, m]));
  for (const m of changed) byId.set(m.id, m);
  const pending = list.filter((m) => m.pending);
  return [...[...byId.values()].sort((a, b) => a.id - b.id), ...pending];
}

/** The open conversation: messages, the composer, edits, and a poll that keeps it current. */
export function ChatRoom(props: {
  channelId: number;
  me: { id: number; name: string; isOwner: boolean };
  initial: RoomMessage[];
  now: string;
  lastReadId: number;
  people: RoomPerson[];
  placeholder: string;
  readOnly?: string | null; // why nothing can be posted (an archived channel)
  joinHint?: React.ReactNode;
}) {
  const { channelId, me } = props;
  const [messages, setMessages] = useState(props.initial);
  const [hasOlder, setHasOlder] = useState(props.initial.length >= 50);
  const [error, setError] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const since = useRef(props.now);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // keep the view at the bottom while the reader is there
  const firstUnread = useRef(props.initial.find((m) => m.id > props.lastReadId && m.userId !== me.id)?.id ?? null);

  const atBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewBelow(false);
  }, []);

  const poll = useCallback(async () => {
    const visible = document.visibilityState === "visible";
    const newest = messages.filter((m) => !m.pending).at(-1)?.id ?? 0;
    const q = new URLSearchParams({ since: since.current });
    if (visible && newest && atBottom()) q.set("read", String(newest));
    try {
      const res = await fetch(`/chat/${channelId}/updates?${q}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { now: string; messages: RoomMessage[]; unread: Record<string, number> };
      since.current = data.now;
      window.dispatchEvent(new CustomEvent("chat:unread", { detail: data.unread }));
      if (!data.messages.length) return;
      stick.current = atBottom();
      setMessages((list) => merge(list, data.messages));
      if (!stick.current && data.messages.some((m) => m.userId !== me.id && m.id > newest)) setNewBelow(true);
    } catch {
      // offline for a moment: the next poll catches up
    }
  }, [channelId, me.id, messages]);

  const pollRef = useRef(poll);
  pollRef.current = poll;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await pollRef.current();
      timer = setTimeout(loop, document.visibilityState === "visible" ? POLL_VISIBLE : POLL_HIDDEN);
    };
    timer = setTimeout(loop, POLL_VISIBLE);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void loop();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  // open at the first unread message, else at the bottom
  useLayoutEffect(() => {
    const el = firstUnread.current && document.getElementById(`m${firstUnread.current}`);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 80;
    else toBottom();
  }, [toBottom]);
  useLayoutEffect(() => {
    if (stick.current) toBottom();
  }, [messages, toBottom]);

  const loadOlder = async () => {
    const first = messages.find((m) => !m.pending);
    if (!first) return;
    const el = scroller.current;
    const height = el?.scrollHeight ?? 0;
    const res = await fetch(`/chat/${channelId}/updates?before=${first.id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { messages: RoomMessage[] };
    setHasOlder(data.messages.length >= 50);
    stick.current = false;
    setMessages((list) => merge(list, data.messages));
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - height; // keep the reader's place
    });
  };

  const send = async (body: string) => {
    setError(null);
    const temp: RoomMessage = { id: -Date.now(), userId: me.id, author: me.name, body, createdAt: new Date().toISOString(), editedAt: null, deleted: false, pending: true };
    stick.current = true;
    setMessages((list) => [...list, temp]);
    const r = await sendMessageAction({ channelId, body });
    if (!r.ok) {
      setMessages((list) => list.filter((m) => m.id !== temp.id));
      setError(r.error);
      return false;
    }
    await poll();
    setMessages((list) => list.filter((m) => m.id !== temp.id));
    return true;
  };

  const saveEdit = async (id: number, body: string) => {
    const r = await editMessageAction({ id, body });
    if (!r.ok) return setError(r.error);
    setEditing(null);
    await poll();
  };

  const remove = async (id: number) => {
    if (!window.confirm("Delete this message? Everyone will see that a message was deleted.")) return;
    const r = await deleteMessageAction({ id });
    if (!r.ok) return setError(r.error);
    await poll();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        role="log"
        aria-label="Messages"
        tabIndex={0}
        onScroll={() => {
          stick.current = atBottom();
          if (stick.current) setNewBelow(false);
        }}
        className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4 outline-none sm:px-5"
      >
        {hasOlder && (
          <div className="mb-3 text-center">
            <button type="button" onClick={loadOlder} className="btn btn-ghost btn-sm">
              Load earlier messages
            </button>
          </div>
        )}
        {!messages.length && <p className="py-16 text-center text-sm text-muted">No messages yet. Say hello.</p>}
        <ol className="flex flex-col">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || ymd(prev.createdAt) !== ymd(m.createdAt);
            const grouped = !newDay && prev && prev.userId === m.userId && !prev.deleted && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
            const mine = m.userId === me.id;
            return (
              <li key={m.id} id={m.id > 0 ? `m${m.id}` : undefined}>
                {newDay && (
                  <div className="my-3 flex items-center gap-3 text-xs font-medium text-muted" role="separator">
                    <span className="h-px flex-1 bg-line" />
                    {dayLabel(m.createdAt)}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                {m.id === firstUnread.current && (
                  <div className="my-2 flex items-center gap-3 text-xs font-semibold text-brand" role="separator">
                    <span className="h-px flex-1 bg-brand/50" />
                    New
                    <span className="h-px flex-1 bg-brand/50" />
                  </div>
                )}
                <div className={`group relative flex gap-3 rounded-lg px-2 hover:bg-raised/50 ${grouped ? "py-0.5" : "mt-2 py-1"} ${m.pending ? "opacity-60" : ""}`}>
                  <div className="w-8 shrink-0">{!grouped && <Avatar name={m.author} size={32} />}</div>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{m.author}</span>
                        <time dateTime={m.createdAt} className="text-xs text-muted">
                          {clock.format(new Date(m.createdAt))}
                        </time>
                      </div>
                    )}
                    {m.deleted ? (
                      <p className="text-sm italic text-muted">This message was deleted.</p>
                    ) : editing === m.id ? (
                      <Composer
                        people={props.people}
                        initial={m.body}
                        label="Edit message"
                        placeholder="Edit your message"
                        onSubmit={(b) => saveEdit(m.id, b).then(() => true)}
                        onCancel={() => setEditing(null)}
                        compact
                      />
                    ) : (
                      <div dir="auto" className="break-words text-[15px] leading-6">
                        <ChatText source={m.body} />
                        {m.editedAt && <span className="ml-1 text-xs text-muted">(edited)</span>}
                      </div>
                    )}
                  </div>
                  {!m.deleted && !m.pending && editing !== m.id && (mine || me.isOwner) && (
                    <div className="absolute -top-3 right-2 hidden gap-1 rounded-lg border border-line bg-surface p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
                      {mine && (
                        <button type="button" onClick={() => setEditing(m.id)} className="btn btn-ghost btn-sm btn-icon h-7 w-7" aria-label="Edit message">
                          <Icon name="edit" size={13} />
                        </button>
                      )}
                      <button type="button" onClick={() => remove(m.id)} className="btn btn-ghost btn-sm btn-icon h-7 w-7 text-danger" aria-label="Delete message">
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {newBelow && (
        <div className="relative">
          <button type="button" onClick={toBottom} className="btn btn-primary btn-sm absolute -top-12 left-1/2 -translate-x-1/2 shadow-lg">
            <Icon name="chevronDown" size={14} /> New messages
          </button>
        </div>
      )}
      <div className="border-t border-line px-3 py-3 sm:px-5">
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        )}
        {props.joinHint}
        {props.readOnly ? (
          <p className="text-center text-sm text-muted">{props.readOnly}</p>
        ) : (
          <Composer people={props.people.filter((p) => p.id !== me.id)} label="Message" placeholder={props.placeholder} onSubmit={send} />
        )}
      </div>
    </div>
  );
}

/** A growing text box: Enter sends, Shift+Enter starts a new line, @ suggests people. */
function Composer(props: {
  people: RoomPerson[];
  label: string;
  placeholder: string;
  initial?: string;
  compact?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const caretTo = useRef<number | null>(null); // where the cursor goes after a mention is filled in

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    // placed before the browser handles the next key, so fast typing after a mention lands after it
    if (caretTo.current !== null) {
      el.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = null;
    }
  }, [value]);
  useEffect(() => {
    if (props.initial !== undefined) box.current?.focus();
  }, [props.initial]);

  // the word being typed, if it starts with @
  const caret = box.current?.selectionStart ?? value.length;
  const token = /(^|\s)@([\p{L}\p{N}]*)$/u.exec(value.slice(0, caret));
  const matches = token
    ? props.people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(token[2].toLowerCase())) || p.name.replace(/\s+/g, "").toLowerCase().startsWith(token[2].toLowerCase())).slice(0, 6)
    : [];

  const choose = (p: RoomPerson) => {
    if (!token) return;
    const start = caret - token[2].length - 1;
    const handle = p.name.trim().split(/\s+/)[0];
    caretTo.current = start + handle.length + 2;
    setValue(`${value.slice(0, start)}@${handle} ${value.slice(caret)}`);
    setPick(0);
    box.current?.focus();
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    const keep = value;
    if (!props.initial) setValue("");
    const ok = await props.onSubmit(body);
    if (!ok && !props.initial) setValue(keep);
    setBusy(false);
    box.current?.focus();
  };

  return (
    <div className="relative">
      {matches.length > 0 && (
        <ul role="listbox" aria-label="People" className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(p);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === pick ? "bg-raised" : ""}`}
              >
                <Avatar name={p.name} size={22} /> {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={`flex items-end gap-2 rounded-xl border border-line bg-surface ${props.compact ? "p-1.5" : "p-2"} focus-within:border-brand/60`}>
        <label className="sr-only" htmlFor={props.compact ? "chat-edit" : "chat-compose"}>
          {props.label}
        </label>
        <textarea
          ref={box}
          id={props.compact ? "chat-edit" : "chat-compose"}
          dir="auto"
          rows={1}
          maxLength={MAX}
          value={value}
          placeholder={props.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setPick(0);
          }}
          onKeyDown={(e) => {
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setPick((n) => (n + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            } else if (matches.length && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              choose(matches[Math.min(pick, matches.length - 1)]);
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape" && props.onCancel) props.onCancel();
          }}
          className="max-h-[200px] min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted"
        />
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        )}
        <button type="button" onClick={submit} disabled={busy || !value.trim()} className="btn btn-primary btn-sm" aria-label={props.initial ? "Save" : "Send"}>
          {props.initial ? "Save" : <Icon name="send" size={15} />}
        </button>
      </div>
      {!props.compact && <p className="mt-1.5 hidden text-xs text-muted sm:block">Enter to send · Shift+Enter for a new line · @ to mention someone · **bold**, *italic*, `code`</p>}
    </div>
  );
}
