import { db } from "@/db";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { Flash } from "@/components/Flash";
import { EmptyState } from "@/components/ui";
import { listConversations } from "@/lib/chat";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Chat" };

export default async function ChatHome(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("chat:write");
  const list = await listConversations(db, user.id);
  return (
    <>
      <h1 className="sr-only">Chat</h1>
      <Flash {...sp} />
      <ChatLayout list={list} current={null}>
        <div className="grid flex-1 place-items-center p-8">
          <EmptyState icon="chat" title="Team chat">
            Pick a conversation on the left, or start a new one. Everyone on the team is in #general.
          </EmptyState>
        </div>
      </ChatLayout>
    </>
  );
}
