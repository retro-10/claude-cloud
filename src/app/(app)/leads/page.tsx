import Link from "next/link";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { savedViews, sources, stages, users } from "@/db/schema";
import { SpeedBadge } from "@/components/SpeedBadge";
import { VIEW_KEYS, listLeads, type LeadFilters } from "@/lib/lead-list";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { deleteViewAction, saveViewAction } from "./actions";

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"];
const pretty = (s: string | null) => (s ? s.replace(/_/g, " ") : "");

const field = "rounded border border-line bg-surface px-2 py-1.5 text-sm";

export default async function LeadsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = await requireUser();
  const f = searchParams as LeadFilters;
  const [{ rows, total, page, pages }, stageList, sourceList, userList, views] = await Promise.all([
    listLeads(db, f),
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select().from(savedViews).where(or(eq(savedViews.userId, user.id), eq(savedViews.shared, true))).orderBy(asc(savedViews.name)),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...over })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const viewQuery = new URLSearchParams(
    VIEW_KEYS.flatMap((k) => (searchParams[k] ? [[k, searchParams[k]!] as [string, string]] : [])),
  ).toString();
  const sortHref = (key: string) => qs({ sort: key, dir: f.sort === key && f.dir !== "asc" ? "asc" : "desc", page: undefined });
  const canWrite = can(user.role, "lead:write");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl">{f.deleted === "1" ? "Deleted leads" : "Leads"}</h1>
        <span className="text-sm text-muted">{total} total</span>
        <Link href={f.deleted === "1" ? "/leads" : "/leads?deleted=1"} className="ml-auto text-xs text-muted underline">
          {f.deleted === "1" ? "Back to live leads" : can(user.role, "lead:delete") ? "Show deleted" : ""}
        </Link>
      </div>

      {views.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Views:</span>
          {views.map((v) => (
            <span key={v.id} className="flex items-center rounded border border-line bg-surface">
              <Link href={`/leads?${new URLSearchParams(v.filters).toString()}`} className="px-2 py-1 hover:text-gold" dir="auto">
                {v.name}
              </Link>
              {canWrite && (v.userId === user.id || user.role === "owner") && (
                <form action={deleteViewAction}>
                  <input type="hidden" name="id" value={v.id} />
                  <button className="px-1.5 text-muted hover:text-red-400" aria-label={`Delete view ${v.name}`}>
                    ×
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
      )}

      <form className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" method="get">
        {f.deleted === "1" && <input type="hidden" name="deleted" value="1" />}
        <input id="search" name="q" defaultValue={f.q} placeholder="Search name, phone, email, notes ( / )" dir="auto" className={`${field} col-span-2 sm:col-span-4 lg:col-span-2`} />
        <select name="stage" defaultValue={f.stage ?? ""} className={field} aria-label="Stage">
          <option value="">All stages</option>
          {stageList.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={f.source ?? ""} className={field} aria-label="Source">
          <option value="">All sources</option>
          {sourceList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="segment" defaultValue={f.segment ?? ""} className={field} aria-label="Segment">
          <option value="">All segments</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {pretty(s)}
            </option>
          ))}
        </select>
        <select name="tier" defaultValue={f.tier ?? ""} className={field} aria-label="Tier interest">
          <option value="">All tiers</option>
          {TIERS.map((s) => (
            <option key={s} value={s}>
              {pretty(s)}
            </option>
          ))}
        </select>
        <select name="owner" defaultValue={f.owner ?? ""} className={field} aria-label="Owner">
          <option value="">Any owner</option>
          <option value="none">Unassigned</option>
          {userList.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          From <input type="date" name="from" defaultValue={f.from} className={`${field} flex-1`} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          To <input type="date" name="to" defaultValue={f.to} className={`${field} flex-1`} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={f.overdue === "1"} /> Overdue follow-up
        </label>
        <div className="flex gap-2">
          <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Filter</button>
          <Link href="/leads" className="px-2 py-1.5 text-sm text-muted">
            Clear
          </Link>
        </div>
      </form>

      {canWrite && viewQuery && (
        <form action={saveViewAction} className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="query" value={viewQuery} />
          <input name="name" required maxLength={60} placeholder="Save this filter as…" dir="auto" className={field} />
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" name="shared" /> shared
          </label>
          <button className="rounded border border-line px-2 py-1.5">Save view</button>
        </form>
      )}

      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">
                <Link href={sortHref("name")}>Name</Link>
              </th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">
                <Link href={sortHref("stage")}>Stage</Link>
              </th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Next follow-up</th>
              <th className="px-3 py-2">
                <Link href={sortHref("created")}>Created</Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-t border-line hover:bg-surface/60">
                <td className="px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:text-gold" dir="auto">
                    {l.fullName}
                  </Link>{" "}
                  <SpeedBadge createdAt={l.createdAt} firstContactAt={l.firstContactAt} />
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {l.phone}
                </td>
                <td className="px-3 py-2">{l.stageLabel}</td>
                <td className="px-3 py-2">{l.source}</td>
                <td className="px-3 py-2">{l.owner}</td>
                <td className="px-3 py-2">{l.nextFollowUp ? formatCairo(new Date(l.nextFollowUp), false) : ""}</td>
                <td className="px-3 py-2 text-muted">{formatCairo(l.createdAt, false)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  No leads match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link href={qs({ page: String(page - 1) })}>← Prev</Link>}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={qs({ page: String(page + 1) })}>Next →</Link>}
        </div>
      )}
    </>
  );
}
