import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { ChatRoom } from "@/components/chat/ChatRoom";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { Avatar, Icon } from "@/components/ui";
import { chatPeople, getConversation, listConversations, listMessages } from "@/lib/chat";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { archiveChannelAction, joinChannelAction, leaveChannelAction, updateChannelAction } from "../actions";

export const metadata = { title: "Chat" };

export default async function ChatConversation(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("chat:write");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const conv = await getConversation(db, user.id, id);
  if (!conv) notFound();
  const [list, messages, people] = await Promise.all([listConversations(db, user.id), listMessages(db, user.id, id), chatPeople(db)]);
  const isOwner = can(user.role, "settings:write");
  const canManage = conv.kind === "channel" && (isOwner || conv.createdBy === user.id);
  const title = conv.kind === "channel" ? `#${conv.title}` : conv.title;
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  return (
    <>
      <h1 className="sr-only">Chat: {title}</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <ChatLayout list={list} current={id}>
        <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-5">
          <Link href="/chat" className="btn btn-ghost btn-sm btn-icon lg:hidden" aria-label="All conversations">
            <Icon name="chevronLeft" size={16} />
          </Link>
          {conv.kind === "dm" ? (
            <div className="flex -space-x-2" aria-hidden>
              {conv.people
                .filter((p) => p.id !== user.id)
                .slice(0, 3)
                .map((p) => (
                  <Avatar key={p.id} name={p.name} size={28} />
                ))}
            </div>
          ) : (
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-raised text-base font-semibold text-muted">
              #
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold" dir="auto">
              {title}
              {conv.archived && <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-xs font-normal text-muted">Archived</span>}
            </div>
            <div className="truncate text-xs text-muted" dir="auto">
              {conv.kind === "dm" ? `${conv.people.length} people` : conv.everyone ? `Everyone on the team${conv.topic ? ` · ${conv.topic}` : ""}` : (conv.topic ?? "No topic")}
            </div>
          </div>
          {conv.kind === "channel" && conv.joined && !conv.everyone && !conv.archived && (
            <form action={leaveChannelAction}>
              <input type="hidden" name="id" value={id} />
              <button className="btn btn-ghost btn-sm">Leave</button>
            </form>
          )}
          {canManage && (
            <details className="relative">
              <summary className="btn btn-ghost btn-sm btn-icon list-none" aria-label="Channel settings">
                <Icon name="settings" size={15} />
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-lg">
                <form action={updateChannelAction} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={id} />
                  <label className="text-sm">
                    <span className="mb-1 block text-muted">Name</span>
                    <input name="name" defaultValue={conv.name ?? ""} required maxLength={40} className="input" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-muted">Topic</span>
                    <input name="topic" defaultValue={conv.topic ?? ""} maxLength={200} className="input" />
                  </label>
                  <button className="btn btn-secondary btn-sm">Save</button>
                </form>
                {(!conv.everyone || isOwner) && (
                  <form action={archiveChannelAction} className="mt-3 border-t border-line pt-3">
                    <input type="hidden" name="id" value={id} />
                    {conv.archived ? (
                      <>
                        <input type="hidden" name="restore" value="1" />
                        <button className="btn btn-secondary btn-sm w-full">Restore the channel</button>
                      </>
                    ) : (
                      <ConfirmButton message={`Archive ${title}? It leaves everyone's list and takes no new messages. The history stays.`} className="btn btn-danger btn-sm w-full">
                        Archive the channel
                      </ConfirmButton>
                    )}
                  </form>
                )}
              </div>
            </details>
          )}
        </header>
        <ChatRoom
          key={id}
          channelId={id}
          me={{ id: user.id, name: user.name, isOwner }}
          initial={(messages ?? []).map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), editedAt: iso(m.editedAt) }))}
          now={new Date().toISOString()}
          lastReadId={conv.lastReadId}
          people={conv.kind === "dm" ? conv.people : people}
          placeholder={`Message ${title}`}
          readOnly={conv.archived ? "This channel is archived: its history stays readable, new messages are off." : null}
          joinHint={
            conv.kind === "channel" && !conv.joined && !conv.archived ? (
              <form action={joinChannelAction} className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-raised px-3 py-2 text-sm">
                <span className="text-muted">You are reading {title}. Join to see it in your list and get unread counts.</span>
                <input type="hidden" name="id" value={id} />
                <button className="btn btn-primary btn-sm">Join</button>
              </form>
            ) : null
          }
        />
      </ChatLayout>
    </>
  );
}
