import { Flash } from "@/components/Flash";
import { AssetFields } from "@/components/brand/AssetFields";
import { Card, PageHeader } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { createAssetAction } from "../../actions";

export const metadata = { title: "Add an asset · Brand hub" };

export default async function NewAsset(props: { searchParams: Promise<{ error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("brand:manage");
  return (
    <>
      <PageHeader eyebrow="Brand hub" title="Add an asset" subtitle="A file people may use: a logo, a photo, a template, a font. Large videos: add a link instead of the file." />
      <Flash error={sp.error} />
      <Card className="max-w-2xl">
        <AssetFields action={createAssetAction} />
      </Card>
    </>
  );
}
