import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { changedSince, listConversations, listMessages, markRead, type ChatMessage } from "@/lib/chat";
import { can } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// Polled by the open conversation every few seconds:
//   ?since=<iso>  messages added, edited or deleted since then (with a few seconds of overlap; the page merges by id)
//   ?before=<id>  the page of older messages before that one (scrolling back)
//   &read=<id>    I have seen up to that message (only sent while the tab is visible)
// Also returns every conversation's unread count, so the list beside it stays current.
const OVERLAP_MS = 5000;

const json = (m: ChatMessage) => ({ ...m, createdAt: m.createdAt.toISOString(), editedAt: m.editedAt?.toISOString() ?? null });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "chat:write")) return new NextResponse("Forbidden", { status: 403 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse("Not found", { status: 404 });
  const q = req.nextUrl.searchParams;
  const now = new Date();

  const before = Number(q.get("before"));
  const sinceMs = Date.parse(q.get("since") ?? "");
  const messages = Number.isInteger(before) && before > 0
    ? await listMessages(db, user.id, id, { before })
    : await changedSince(db, user.id, id, new Date((Number.isFinite(sinceMs) ? sinceMs : now.getTime()) - OVERLAP_MS));
  if (!messages) return new NextResponse("Not found", { status: 404 });

  const read = Number(q.get("read"));
  if (Number.isInteger(read) && read > 0) await markRead(db, user.id, id, read);
  const { channels, dms } = await listConversations(db, user.id);
  return NextResponse.json(
    { now: now.toISOString(), messages: messages.map(json), unread: Object.fromEntries([...channels, ...dms].map((c) => [c.id, c.unread])) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
