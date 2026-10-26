import { Flash } from "@/components/Flash";
import { SpaceForm } from "@/components/hq/SpaceForm";
import { PageHeader } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "New space" };

export default async function NewSpacePage(props: { searchParams: Promise<{ error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("ops:manage");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="HQ" title="New space" subtitle="A space is one area of the company. It holds lists of tasks and docs, and decides the statuses its tasks move through." />
      <Flash error={sp.error} />
      <SpaceForm back="/spaces/new" />
    </div>
  );
}
