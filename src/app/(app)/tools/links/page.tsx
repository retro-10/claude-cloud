import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { LinkBuilder } from "@/components/tools/LinkBuilder";
import { PageHeader } from "@/components/ui";
import { listForms } from "@/lib/lead-forms";
import { publicBaseUrl } from "@/lib/public-url";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Tracked links · Tools" };

export default async function LinksPage() {
  await requirePageCan("lead:read");
  const [forms, camps, base] = await Promise.all([
    listForms(db),
    db.select({ slug: campaigns.slug, label: campaigns.label }).from(campaigns).where(isNotNull(campaigns.slug)),
    publicBaseUrl(),
  ]);
  return (
    <>
      <PageHeader eyebrow="Tools" title="Tracked links" subtitle="A link (and QR code) for each post, story, ad or flyer, so every lead says exactly where it came from." />
      <LinkBuilder base={base} forms={forms.filter((f) => f.active).map((f) => ({ slug: f.slug, title: f.title }))} campaigns={camps.map((c) => ({ slug: c.slug!, label: c.label }))} />
    </>
  );
}
