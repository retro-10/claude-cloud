import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { AssetFields } from "@/components/brand/AssetFields";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { ALLOWED_EXT } from "@/lib/attachments";
import { assetTypeLabel, getAsset } from "@/lib/brand";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { newVersionAction, retireAssetAction, updateAssetAction } from "../../actions";

export const metadata = { title: "Asset · Brand hub" };
const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");

export default async function AssetPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("brand:read");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const a = await getAsset(db, id);
  if (!a) notFound();
  const manage = can(user.role, "brand:manage");
  const retired = a.status === "retired";
  const image = a.fileId && a.contentType?.startsWith("image/") && a.contentType !== "image/heic";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/brand" className="hover:text-fg">
            Brand hub
          </Link>
        }
        title={a.name}
        titleDir="auto"
        subtitle={`${assetTypeLabel(a.type)}${a.version ? ` · version ${a.version}` : ""} · added by ${a.creator ?? "someone"} on ${formatCairo(a.createdAt, false)}`}
      />
      <Flash notice={sp.notice} error={sp.error} />
      {retired && (
        <div role="status" className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          This version is retired and no longer in the library.
          {a.current && (
            <>
              {" "}
              Use{" "}
              <Link href={`/brand/assets/${a.current.id}`} className="font-medium underline">
                the current version
              </Link>{" "}
              instead.
            </>
          )}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <Card>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/files/${a.fileId}?preview=1`} alt={a.name} className="mx-auto max-h-[420px] w-auto object-contain" />
            ) : (
              <p className="py-10 text-center text-sm text-muted">{a.url ? "A link to the file." : "No preview for this kind of file."}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {a.fileId && (
                <a href={`/files/${a.fileId}?download=1`} className="btn btn-primary btn-sm">
                  <Icon name="download" size={14} /> Download
                </a>
              )}
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                  <Icon name="arrowUpRight" size={14} /> Open the link
                </a>
              )}
              <span className="text-sm text-muted">
                {a.downloads} download{a.downloads === 1 ? "" : "s"}
              </span>
            </div>
          </Card>
          {a.usageNotes && (
            <Card title="How to use it" icon="note">
              <p className="whitespace-pre-line text-sm" dir="auto">
                {a.usageNotes}
              </p>
            </Card>
          )}
          {a.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.tags.map((t) => (
                <Link key={t} href={`/brand?tag=${encodeURIComponent(t)}`} className="chip">
                  {t}
                </Link>
              ))}
            </div>
          )}
          {manage && sp.edit === "1" && (
            <Card title="Edit details" icon="edit">
              <AssetFields action={updateAssetAction} a={a} />
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Versions" icon="history">
            <ol className="flex flex-col gap-2 text-sm">
              {a.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  {v.id === a.id ? (
                    <span className="font-medium">{v.version ? `Version ${v.version}` : `Added ${formatCairo(v.createdAt, false)}`} (this one)</span>
                  ) : (
                    <Link href={`/brand/assets/${v.id}`} className="link">
                      {v.version ? `Version ${v.version}` : `Added ${formatCairo(v.createdAt, false)}`}
                    </Link>
                  )}
                  <span className={`chip ${v.status === "active" ? "chip-ok" : ""}`}>{v.status === "active" ? "Current" : "Retired"}</span>
                </li>
              ))}
            </ol>
          </Card>
          {manage && !retired && (
            <Card title="Upload a new version" icon="upload">
              <form action={newVersionAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={a.id} />
                <label className="field">
                  Version
                  <input name="version" maxLength={40} className="input input-sm" placeholder="e.g. 2027" />
                </label>
                <label className="field">
                  File
                  <input type="file" name="file" accept={ACCEPT} className="input input-sm py-1.5" />
                </label>
                <label className="field">
                  Or a link
                  <input name="url" type="url" maxLength={1000} dir="ltr" className="input input-sm" />
                </label>
                <p className="text-xs text-muted">The version above is retired: it leaves the library, and its page points here.</p>
                <button className="btn btn-primary btn-sm self-start">Add the new version</button>
              </form>
            </Card>
          )}
          {manage && (
            <div className="flex flex-wrap gap-2">
              {!retired && (
                <Link href={`/brand/assets/${a.id}?edit=1`} className="btn btn-secondary btn-sm">
                  Edit details
                </Link>
              )}
              <form action={retireAssetAction}>
                <input type="hidden" name="id" value={a.id} />
                {retired ? (
                  <>
                    <input type="hidden" name="restore" value="1" />
                    <button className="btn btn-secondary btn-sm">Put it back in the library</button>
                  </>
                ) : (
                  <ConfirmButton message="Retire this asset? It leaves the library for everyone; its history stays." className="btn btn-ghost btn-sm">
                    Retire
                  </ConfirmButton>
                )}
              </form>
            </div>
          )}
          {manage && a.recentDownloads.length > 0 && (
            <Card title="Recent downloads" icon="download">
              <ul className="flex flex-col gap-1 text-sm">
                {a.recentDownloads.map((d, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>{d.name ?? "Someone"}</span>
                    <span className="text-xs text-muted">{formatCairo(d.at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
