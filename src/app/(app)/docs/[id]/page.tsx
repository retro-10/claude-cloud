import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DocForm } from "@/components/hq/DocForm";
import { Markdown } from "@/components/hq/Markdown";
import { Flash } from "@/components/Flash";
import { Icon } from "@/components/ui";
import { getDoc, listDocs, listSpaces } from "@/lib/hq";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { archiveDocAction } from "../../hq/actions";

export const metadata = { title: "Doc" };

export default async function DocPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; notice?: string; error?: string }> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  if (!/^\d+$/.test(id)) notFound();
  const [doc, spaces, all] = await Promise.all([getDoc(db, Number(id)), listSpaces(db), listDocs(db)]);
  if (!doc) notFound();
  const canWrite = can(user.role, "task:write");
  const space = spaces.find((s) => s.id === doc.spaceId);
  const parent = all.find((d) => d.id === doc.parentId);
  const editing = canWrite && sp.edit === "1";
  const author = all.find((d) => d.id === doc.id)?.updatedBy;

  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/docs" className="hover:text-fg">
          Docs
        </Link>
        {space && (
          <>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <Link href={`/docs?space=${space.id}`} className="hover:text-fg">
              {space.name}
            </Link>
          </>
        )}
        {parent && (
          <>
            <Icon name="chevronRight" size={14} className="text-faint" />
            <Link href={`/docs/${parent.id}`} className="hover:text-fg">
              {parent.title}
            </Link>
          </>
        )}
      </nav>
      <Flash notice={sp.notice} error={sp.error} />
      {editing ? (
        <DocForm doc={doc} spaces={spaces} parents={all.map((d) => ({ id: d.id, name: d.title }))} back={`/docs/${doc.id}?edit=1`} />
      ) : (
        <article>
          <header className="mb-6 flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="page-title">{doc.title}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {doc.wiki && <span className="chip chip-brand">Wiki</span>}
                Updated {formatCairo(doc.updatedAt)}
                {author ? ` by ${author}` : ""}
              </p>
            </div>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Link href={`/docs/new?parent=${doc.id}${doc.spaceId ? `&space=${doc.spaceId}` : ""}`} className="btn btn-ghost btn-sm">
                  <Icon name="plus" size={14} /> Sub-page
                </Link>
                <Link href={`/docs/${doc.id}?edit=1`} className="btn btn-secondary btn-sm">
                  <Icon name="edit" size={14} /> Edit
                </Link>
                <form action={archiveDocAction}>
                  <input type="hidden" name="id" value={doc.id} />
                  <input type="hidden" name="back" value={`/docs/${doc.id}`} />
                  <ConfirmButton className="btn btn-ghost btn-sm" message={`Archive “${doc.title}”${doc.children.length ? ` and its ${doc.children.length} sub-pages` : ""}?`}>
                    <Icon name="trash" size={14} /> Archive
                  </ConfirmButton>
                </form>
              </div>
            )}
          </header>
          <Markdown source={doc.body} />
          {doc.children.length > 0 && (
            <section className="mt-10">
              <h2 className="eyebrow mb-3">Pages inside</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {doc.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/docs/${c.id}`} className="card flex items-center gap-3 p-4 hover:border-brand/50">
                      <Icon name="note" className="text-accent" />
                      <span className="truncate text-sm font-medium">{c.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </div>
  );
}
