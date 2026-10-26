import { db } from "@/db";
import { DocForm } from "@/components/hq/DocForm";
import { Flash } from "@/components/Flash";
import { PageHeader } from "@/components/ui";
import { listDocs, listSpaces } from "@/lib/hq";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "New doc" };

export default async function NewDocPage(props: { searchParams: Promise<{ space?: string; parent?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("task:write");
  const [spaces, docs] = await Promise.all([listSpaces(db), listDocs(db)]);
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Docs" title="New doc" />
      <Flash error={sp.error} />
      <DocForm spaces={spaces} parents={docs.map((d) => ({ id: d.id, name: d.title }))} back={`/docs/new${sp.space ? `?space=${num(sp.space) ?? ""}` : ""}`} spaceId={num(sp.space)} parentId={num(sp.parent)} />
    </div>
  );
}
