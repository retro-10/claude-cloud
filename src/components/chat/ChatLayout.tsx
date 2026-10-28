import type { Conversation } from "@/lib/chat";
import { ChatNav } from "./ChatNav";
import { FillHeight } from "./FillHeight";

// Chat fills the page below the top bar: the conversation list on the left, the open conversation on the right.
// On a phone only one shows at a time: the list on /chat, the conversation on /chat/<id>.
export function ChatLayout({ list, current, children }: { list: { channels: Conversation[]; dms: Conversation[] }; current: number | null; children: React.ReactNode }) {
  const slim = (c: Conversation) => ({ id: c.id, kind: c.kind, title: c.title, unread: c.unread });
  return (
    <FillHeight className="-mb-24 flex h-[calc(100dvh-11rem)] overflow-hidden rounded-2xl border border-line bg-surface sm:-mb-12">
      <aside className={`w-full shrink-0 overflow-y-auto border-line lg:block lg:w-64 lg:border-r ${current ? "hidden" : ""}`}>
        <ChatNav channels={list.channels.map(slim)} dms={list.dms.map(slim)} current={current} />
      </aside>
      <section className={`min-w-0 flex-1 flex-col ${current ? "flex" : "hidden lg:flex"}`}>{children}</section>
    </FillHeight>
  );
}
