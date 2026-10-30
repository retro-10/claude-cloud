import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { listDocs, listSpaces, type DocRow } from "@/lib/hq";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Docs" };

function Tree({ rows, all, depth = 0 }: { rows: DocRow[]; all: DocRow[]; depth?: number }) {
  return (
    <ul className={depth ? "border-l border-line/70 pl-4" : "divide-y divide-line"}>
      {rows.map((d) => {
        const kids = all.filter((c) => c.parentId === d.id);
        return (
          <li key={d.id} className={depth ? "py-1" : "px-5 py-3"}>
            <Link href={`/docs/${d.id}`} className="group flex items-center gap-3 rounded-lg py-1 hover:text-accent">
              <Icon name="note" size={16} className="shrink-0 text-muted group-hover:text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.title}</span>
              {d.wiki && <span className="chip chip-brand">Wiki</span>}
              <span className="hidden shrink-0 text-xs text-muted sm:inline">
                {d.updatedBy ?? "—"} · {formatCairo(d.updatedAt, false)}
              </span>
            </Link>
            {kids.length > 0 && depth < 4 && <Tree rows={kids} all={all} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

// The company's written knowledge: how-tos, briefs, policies. Wiki docs are the trusted version.
export default async function DocsPage(props: { searchParams: Promise<{ q?: string; space?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("hq:read");
  const q = (sp.q ?? "").slice(0, 100);
  const [spaces, docs] = await Promise.all([listSpaces(db), listDocs(db, { q })]);
  const space = spaces.find((s) => String(s.id) === sp.space);
  const shown = space ? docs.filter((d) => d.spaceId === space.id) : docs;
  // when searching, show matches flat; otherwise a tree of pages
  const top = q ? shown : shown.filter((d) => !d.parentId || !shown.some((p) => p.id === d.parentId));
  const groups = space ? [{ id: space.id, name: space.name }] : [...spaces.map((s) => ({ id: s.id as number | null, name: s.name })), { id: null, name: "Whole company" }];

  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Docs"
        subtitle="How we do things, written down once: playbooks, briefs, policies and notes. Mark the trusted version as Wiki."
        actions={
          can(user.role, "task:write") && (
            <Link href={`/docs/new${space ? `?space=${space.id}` : ""}`} className="btn btn-primary btn-sm">
              <Icon name="plus" size={14} /> New doc
            </Link>
          )
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex flex-wrap gap-2">
          <Link href="/docs" className={`chip ${!space ? "chip-brand" : "hover:text-fg"}`} aria-current={!space ? "page" : undefined}>
            All
          </Link>
          {spaces.map((s) => (
            <Link key={s.id} href={`/docs?space=${s.id}`} className={`chip ${space?.id === s.id ? "chip-brand" : "hover:text-fg"}`} aria-current={space?.id === s.id ? "page" : undefined}>
              {s.name}
            </Link>
          ))}
        </div>
        <form action="/docs" className="flex gap-2 md:ml-auto">
          {space && <input type="hidden" name="space" value={space.id} />}
          <label className="sr-only" htmlFor="docs-q">
            Search docs
          </label>
          <input id="docs-q" name="q" defaultValue={q} placeholder="Search titles and text" className="input input-sm w-64" />
          <button className="btn btn-secondary btn-sm">Search</button>
        </form>
      </div>
      {!shown.length ? (
        <Card>
          <EmptyState icon="note" title={q ? "No doc matches" : "No docs yet"}>
            {q ? "Try other words." : "Write the playbooks people ask about twice: the sales script, how a batch is prepared, the studio's QC checklist."}
          </EmptyState>
        </Card>
      ) : q ? (
        <Card bodyClass="p-0">
          <Tree rows={top} all={[]} />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => {
            const rows = top.filter((d) => d.spaceId === g.id);
            if (!rows.length) return null;
            return (
              <Card key={g.id ?? "company"} title={g.name} icon={g.id ? "layers" : "note"} bodyClass="p-0">
                <Tree rows={rows} all={shown} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
