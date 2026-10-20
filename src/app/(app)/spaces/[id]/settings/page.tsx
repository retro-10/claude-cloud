import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { ListsCard, SpaceForm } from "@/components/hq/SpaceForm";
import { Card, Icon, PageHeader } from "@/components/ui";
import { listSpaces } from "@/lib/hq";
import { requirePageCan } from "@/lib/server-auth";
import { archiveSpaceAction } from "../../../hq/actions";

export const metadata = { title: "Space settings" };

export default async function SpaceSettingsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  await requirePageCan("ops:manage");
  const space = (await listSpaces(db)).find((s) => String(s.id) === id);
  if (!space) notFound();
  const back = `/spaces/${space.id}/settings`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href={`/spaces/${space.id}`} className="inline-flex items-center gap-1 hover:text-fg">
            <Icon name="chevronLeft" size={12} /> {space.name}
          </Link>
        }
        title="Space settings"
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="flex flex-col gap-6">
        <SpaceForm space={space} back={back} />
        <ListsCard spaceId={space.id} lists={space.lists} back={back} />
        <Card title="Archive this space" icon="trash">
          <p className="mb-4 text-sm text-muted">Archiving hides the space, its lists and their tasks from HQ. Tasks stay on each person&apos;s own task list and in the audit log.</p>
          <form action={archiveSpaceAction}>
            <input type="hidden" name="id" value={space.id} />
            <input type="hidden" name="back" value={back} />
            <ConfirmButton className="btn btn-danger btn-sm" message={`Archive ${space.name}? Its ${space.open} open tasks leave HQ.`}>
              Archive {space.name}
            </ConfirmButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
