import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ROLE_LABEL, feed } from "@/lib/announcements";
import { can, type Role } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Announcements" };

// What the company told me: pinned first, then newest. Must-reads say whether I have acknowledged them.
export default async function AnnouncementsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("comms:read");
  const items = await feed(db, user.id);
  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Announcements"
        subtitle="News and policies for you or your team. Some must be read and acknowledged."
        actions={
          can(user.role, "comms:post") ? (
            <Link href="/announcements/new" className="btn btn-primary btn-sm">
              <Icon name="plus" size={14} /> New announcement
            </Link>
          ) : null
        }
      />
      <Flash {...sp} />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="send" title="No announcements yet" />
        </Card>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-3">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={`/announcements/${a.id}`} className={`card block p-4 transition hover:border-brand/50 ${!a.readAt ? "border-brand/40" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {!a.readAt && <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />}
                  <span className="font-semibold" dir="auto">
                    {a.title}
                  </span>
                  {!a.readAt && <span className="sr-only">(new)</span>}
                  {a.pinned && <span className="chip">Pinned</span>}
                  {a.mustAck && <span className={`chip ${a.acknowledgedAt ? "chip-ok" : "chip-warn"}`}>{a.acknowledgedAt ? "Acknowledged" : "Please read and acknowledge"}</span>}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {a.author ?? "HQ"} · {formatCairo(a.publishedAt)} · {a.audience.length ? a.audience.map((r) => ROLE_LABEL[r as Role] ?? r).join(", ") : "Everyone"}
                </div>
                {a.body && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted" dir="auto">
                    {a.body.replace(/[#*`>\[\]]/g, "").slice(0, 300)}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
