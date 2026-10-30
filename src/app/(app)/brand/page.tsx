import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { ASSET_TYPES, allTags, assetTypeLabel, brandPages, listAssets } from "@/lib/brand";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Brand hub" };

// The brand in one place: the guidelines to follow and the approved files to use, so nobody has to ask for a logo.
export default async function BrandHub(props: { searchParams: Promise<{ type?: string; tag?: string; q?: string; retired?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("brand:read");
  const manage = can(user.role, "brand:manage");
  const type = ASSET_TYPES.some((t) => t.key === sp.type) ? sp.type : undefined;
  const retired = manage && sp.retired === "1";
  const [pages, assets, tags] = await Promise.all([brandPages(db), listAssets(db, { type, tag: sp.tag, q: sp.q, retired }), allTags(db)]);
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ type, tag: sp.tag, q: sp.q, retired: retired ? "1" : undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = p.toString();
    return `/brand${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Brand hub"
        subtitle="The guidelines to follow and the approved files to use. Take files from here, not from old chats: retired versions disappear from the library."
        actions={
          manage ? (
            <>
              <Link href="/docs/new?brand=1" className="btn btn-secondary btn-sm">
                <Icon name="note" size={14} /> New guideline page
              </Link>
              <Link href="/brand/assets/new" className="btn btn-primary btn-sm">
                <Icon name="upload" size={14} /> Add an asset
              </Link>
            </>
          ) : (
            <Link href="/approvals/new?type=brand" className="btn btn-secondary btn-sm">
              <Icon name="send" size={14} /> Ask the brand team
            </Link>
          )
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card title="Guidelines" icon="note" className="self-start">
          {pages.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {pages.map((p) => (
                <li key={p.id}>
                  <Link href={`/docs/${p.id}`} className="link" dir="auto">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{manage ? "Write the logo, colour, type and voice rules as pages and tick “Brand guideline”." : "No guideline pages yet."}</p>
          )}
        </Card>
        <div className="min-w-0">
          <Tabs
            label="Kind of asset"
            current={href({})}
            items={[{ href: href({ type: undefined }), label: "All" }, ...ASSET_TYPES.map((t) => ({ href: href({ type: t.key }), label: t.label }))]}
          />
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
            {type && <input type="hidden" name="type" value={type} />}
            {retired && <input type="hidden" name="retired" value="1" />}
            <label className="field min-w-0 flex-1">
              Search
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Name or usage notes" className="input input-sm" />
            </label>
            {tags.length > 0 && (
              <label className="field">
                Tag
                <select name="tag" defaultValue={sp.tag ?? ""} className="input input-sm">
                  <option value="">Any</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn btn-secondary btn-sm">Filter</button>
            {manage && (
              <Link href={href({ retired: retired ? undefined : "1" })} className="btn btn-ghost btn-sm">
                {retired ? "Current assets" : "Retired assets"}
              </Link>
            )}
          </form>
          {assets.length === 0 ? (
            <Card>
              <EmptyState icon="layers" title={retired ? "Nothing retired" : "No assets here yet"} />
            </Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {assets.map((a) => (
                <li key={a.id} className="card flex flex-col overflow-hidden">
                  <Link href={`/brand/assets/${a.id}`} className="block aspect-[4/3] bg-raised" aria-label={`${a.name}, details`}>
                    {a.fileId && a.contentType?.startsWith("image/") && a.contentType !== "image/heic" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/files/${a.fileId}?preview=1`} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
                    ) : (
                      <span className="grid h-full place-items-center text-sm text-muted">{assetTypeLabel(a.type)}</span>
                    )}
                  </Link>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <Link href={`/brand/assets/${a.id}`} className="font-medium hover:text-accent" dir="auto">
                      {a.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {assetTypeLabel(a.type)}
                      {a.version && ` · v${a.version.replace(/^v/i, "")}`}
                      {a.tags.length > 0 && ` · ${a.tags.join(", ")}`}
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-2">
                      {a.fileId ? (
                        <a href={`/files/${a.fileId}?download=1`} className="btn btn-secondary btn-sm">
                          <Icon name="download" size={14} /> Download
                        </a>
                      ) : a.url ? (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                          <Icon name="arrowUpRight" size={14} /> Open
                        </a>
                      ) : null}
                      <span className="ml-auto text-xs text-muted">{a.downloads} downloads</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
