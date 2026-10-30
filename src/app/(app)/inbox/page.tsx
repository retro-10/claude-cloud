import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { inbox, notificationHref, recentNotifications } from "@/lib/notifications";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { inArray } from "drizzle-orm";
import { approvalRequests } from "@/db/schema";
import { canDecide } from "@/lib/approvals";
import { decideApprovalAction } from "../approvals/actions";
import { inboxClearAllAction, inboxReadAction } from "../hq/actions";

export const metadata = { title: "Inbox" };

// Everything the app sent to me: new leads routed to me, replies, mentions of work. Clear what is handled.
export default async function InboxPage(props: { searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("hq:read");
  const tab = sp.tab === "cleared" ? "cleared" : "new";
  const [items, { unread }] = await Promise.all([inbox(db, user.id, tab), recentNotifications(db, user.id, 1)]);
  const back = `/inbox${tab === "cleared" ? "?tab=cleared" : ""}`;
  // approval requests I can decide right here (approve in one click; rejecting needs a reason, on the request)
  const approvalId = (link: string | null) => Number(/^\/approvals\/(\d+)$/.exec(link ?? "")?.[1] ?? 0);
  const ids = [...new Set(items.filter((n) => n.kind === "approval_request").map((n) => approvalId(n.link)).filter(Boolean))];
  const reqs = ids.length ? await db.select().from(approvalRequests).where(inArray(approvalRequests.id, ids)) : [];
  const decidable = new Set(reqs.filter((r) => r.status === "pending" && canDecide(r, user.id)).map((r) => r.id));
  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Inbox"
        subtitle="What the app sent you. Clear an item once it is handled; it moves to Cleared."
        actions={
          tab === "new" && items.length > 0 ? (
            <form action={inboxClearAllAction}>
              <input type="hidden" name="back" value={back} />
              <button className="btn btn-secondary btn-sm">
                <Icon name="check" size={14} /> Clear all
              </button>
            </form>
          ) : null
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs
        label="Inbox"
        current={back}
        items={[
          { href: "/inbox", label: "New", count: unread },
          { href: "/inbox?tab=cleared", label: "Cleared" },
        ]}
      />
      <Card bodyClass="p-0">
        {!items.length ? (
          <EmptyState icon="inbox" title={tab === "new" ? "Inbox zero" : "Nothing cleared yet"}>
            {tab === "new" ? "Nothing new. New items appear here and on the bell." : "Items you clear land here."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-raised/40">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tab === "new" ? "bg-brand" : "bg-faint"}`} />
                <div className="min-w-0 flex-1">
                  {notificationHref(n) ? (
                    <Link href={notificationHref(n)!} className="block truncate text-sm font-medium hover:text-accent">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                  )}
                  <span className="text-xs text-muted">
                    {n.kind.replace(/_/g, " ")} · {formatCairo(n.createdAt)}
                  </span>
                </div>
                {n.kind === "approval_request" && decidable.has(approvalId(n.link)) && (
                  <form action={decideApprovalAction}>
                    <input type="hidden" name="id" value={approvalId(n.link)} />
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="decision" value="approve" />
                    <button className="btn btn-secondary btn-sm" aria-label={`Approve: ${n.title}`}>
                      <Icon name="check" size={14} />
                      <span className="hidden sm:inline">Approve</span>
                    </button>
                  </form>
                )}
                <form action={inboxReadAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <input type="hidden" name="read" value={tab === "new" ? "1" : "0"} />
                  <input type="hidden" name="back" value={back} />
                  <button className="btn btn-ghost btn-sm" aria-label={`${tab === "new" ? "Clear" : "Move back to New"}: ${n.title}`}>
                    <Icon name={tab === "new" ? "check" : "reply"} size={14} />
                    <span className="hidden sm:inline">{tab === "new" ? "Clear" : "Move back"}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
