import Link from "next/link";
import { db } from "@/db";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { Flash } from "@/components/Flash";
import { Avatar, Icon, Tabs } from "@/components/ui";
import { MAX_DM_PEOPLE, chatPeople, listConversations } from "@/lib/chat";
import { requirePageCan } from "@/lib/server-auth";
import { createChannelAction, joinChannelAction, openDmAction } from "../actions";

export const metadata = { title: "New conversation · Chat" };

export default async function NewConversation(props: { searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("chat:write");
  const tab = sp.tab === "channel" || sp.tab === "browse" ? sp.tab : "dm";
  const [list, people] = await Promise.all([listConversations(db, user.id), chatPeople(db)]);
  const others = people.filter((p) => p.id !== user.id);

  return (
    <>
      <h1 className="sr-only">New conversation</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <ChatLayout list={list} current={0}>
        <header className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-5">
          <Link href="/chat" className="btn btn-ghost btn-sm btn-icon lg:hidden" aria-label="All conversations">
            <Icon name="chevronLeft" size={16} />
          </Link>
          <div className="font-semibold">New conversation</div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Tabs
            label="New conversation"
            current={`/chat/new${tab === "dm" ? "" : `?tab=${tab}`}`}
            items={[
              { href: "/chat/new", label: "Direct message" },
              { href: "/chat/new?tab=channel", label: "New channel" },
              { href: "/chat/new?tab=browse", label: "Browse channels", count: list.browse.length },
            ]}
          />
          {tab === "dm" && (
            <form action={openDmAction} className="max-w-xl">
              <fieldset>
                <legend className="mb-3 text-sm text-muted">Pick one person, or up to {MAX_DM_PEOPLE - 1} for a group. Only the people in it can read it.</legend>
                {others.length ? (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {others.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-raised has-[:checked]:bg-brand/10">
                          <input type="checkbox" name="people" value={p.id} className="check" />
                          <Avatar name={p.name} size={26} />
                          <span className="text-sm">{p.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nobody else has an account yet. Add people in Settings › Users.</p>
                )}
              </fieldset>
              <button className="btn btn-primary mt-4">
                <Icon name="send" size={15} /> Open the conversation
              </button>
            </form>
          )}
          {tab === "channel" && (
            <form action={createChannelAction} className="flex max-w-md flex-col gap-4">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Name</span>
                <input name="name" required maxLength={40} placeholder="e.g. sales-team" className="input" />
                <span className="mt-1 block text-xs text-muted">Lowercase, with dashes instead of spaces. Everyone can find and join it.</span>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Topic (optional)</span>
                <input name="topic" maxLength={200} placeholder="What it is for" className="input" />
              </label>
              <button className="btn btn-primary self-start">
                <Icon name="plus" size={15} /> Create the channel
              </button>
            </form>
          )}
          {tab === "browse" &&
            (list.browse.length ? (
              <ul className="max-w-xl divide-y divide-line rounded-xl border border-line">
                {list.browse.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/chat/${c.id}`} className="font-medium hover:text-accent" dir="auto">
                        #{c.name}
                      </Link>
                      {c.topic && (
                        <div className="truncate text-xs text-muted" dir="auto">
                          {c.topic}
                        </div>
                      )}
                    </div>
                    <form action={joinChannelAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn btn-secondary btn-sm">Join</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">You are in every channel. Create a new one in the New channel tab.</p>
            ))}
        </div>
      </ChatLayout>
    </>
  );
}
