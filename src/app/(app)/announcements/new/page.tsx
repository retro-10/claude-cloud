import Link from "next/link";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/announcements";
import { requirePageCan } from "@/lib/server-auth";
import { publishAnnouncementAction } from "../actions";

export const metadata = { title: "New announcement" };

export default async function NewAnnouncement(props: { searchParams: Promise<{ error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("comms:post");
  return (
    <>
      <PageHeader eyebrow="Announcements" title="New announcement" subtitle="Send it to the people who need it: everyone, or only some teams." />
      <Flash error={sp.error} />
      <Card className="max-w-2xl">
        <form action={publishAnnouncementAction} className="flex flex-col gap-4">
          <label className="field">
            Title
            <input name="title" required maxLength={200} dir="auto" className="input" />
          </label>
          <label className="field">
            Message (**bold**, *italic*, lists and links work)
            <textarea name="body" rows={8} maxLength={20000} dir="auto" className="input min-h-40 py-2" />
          </label>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-muted">Who it is for (none ticked: everyone)</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {Object.entries(ROLE_LABEL).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="audience" value={k} className="check" /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="mustAck" className="check" /> Must read: each person acknowledges it; those who have not are reminded daily for two weeks
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pinned" className="check" /> Pin to the top
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary">
              <Icon name="send" size={15} /> Send
            </button>
            <Link href="/announcements" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
