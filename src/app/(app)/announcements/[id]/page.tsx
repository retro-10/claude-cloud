import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Markdown } from "@/components/hq/Markdown";
import { Card, Icon, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ROLE_LABEL, openAnnouncement, tracking } from "@/lib/announcements";
import { can, type Role } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { acknowledgeAction, archiveAnnouncementAction, pinAnnouncementAction } from "../actions";

export const metadata = { title: "Announcement" };

export default async function AnnouncementPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("comms:read");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const manage = can(user.role, "comms:post");
  const a = await openAnnouncement(db, user.id, id, { canSeeAll: manage });
  if (!a || (a.archivedAt && !manage)) notFound();
  const who = manage ? await tracking(db, id) : [];
  const read = who.filter((w) => w.readAt).length;
  const acked = who.filter((w) => w.acknowledgedAt).length;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/announcements" className="hover:text-fg">
            Announcements
          </Link>
        }
        title={a.title}
        titleDir="auto"
        subtitle={`${a.author ?? "HQ"} · ${formatCairo(a.publishedAt)} · ${a.audience.length ? a.audience.map((r) => ROLE_LABEL[r as Role] ?? r).join(", ") : "Everyone"}${a.archivedAt ? " · archived" : ""}`}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <div dir="auto">{a.body ? <Markdown source={a.body} /> : <p className="text-sm text-muted">No message beyond the title.</p>}</div>
          </Card>
          {a.mustAck && a.receipt && (
            <Card className={a.receipt.acknowledgedAt ? "" : "border-warn/50"}>
              {a.receipt.acknowledgedAt ? (
                <p className="text-sm text-ok">
                  <Icon name="check" size={14} className="-mt-0.5 mr-1 inline" />
                  You acknowledged this on {formatCairo(a.receipt.acknowledgedAt)}.
                </p>
              ) : (
                <form action={acknowledgeAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="id" value={a.id} />
                  <p className="flex-1 text-sm">This must be read. Confirm that you have read it and will follow it.</p>
                  <button className="btn btn-primary btn-sm">
                    <Icon name="check" size={14} /> I have read it
                  </button>
                </form>
              )}
            </Card>
          )}
        </div>
        {manage && (
          <div className="flex flex-col gap-4">
            <Card title="Who has seen it" icon="eye">
              <p className="mb-3 text-sm">
                Opened by {read} of {who.length}
                {a.mustAck && `, acknowledged by ${acked}`}.
              </p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {who.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2">
                    <span>{w.name}</span>
                    <span className={`text-xs ${a.mustAck ? (w.acknowledgedAt ? "text-ok" : "text-warn") : w.readAt ? "text-ok" : "text-muted"}`}>
                      {a.mustAck ? (w.acknowledgedAt ? "Acknowledged" : w.readAt ? "Opened, not acknowledged" : "Not opened") : w.readAt ? "Opened" : "Not opened"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="flex flex-wrap gap-2">
              <form action={pinAnnouncementAction}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="pinned" value={a.pinned ? "0" : "1"} />
                <button className="btn btn-secondary btn-sm">{a.pinned ? "Unpin" : "Pin to the top"}</button>
              </form>
              <form action={archiveAnnouncementAction}>
                <input type="hidden" name="id" value={a.id} />
                {a.archivedAt ? (
                  <>
                    <input type="hidden" name="restore" value="1" />
                    <button className="btn btn-secondary btn-sm">Restore</button>
                  </>
                ) : (
                  <ConfirmButton message="Archive this announcement? It leaves everyone's feed and stops reminders." className="btn btn-ghost btn-sm">
                    Archive
                  </ConfirmButton>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
