import Link from "next/link";
import { asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { cadenceTemplates, lostReasons, savedViews, sources, stages, users } from "@/db/schema";
import { ComposeButton } from "@/components/crm/Composer";
import { Flash } from "@/components/Flash";
import { SelectAll } from "@/components/SelectAll";
import { Avatar, EmptyState, Icon, PageHeader, pretty } from "@/components/ui";
import { VIEW_KEYS, listLeads, type LeadFilters } from "@/lib/lead-list";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { formatMinutes, speedBadge } from "@/lib/speed";
import { formatCairo } from "@/lib/time";
import { VIEWS, healthOf, isViewKey } from "@/lib/views";
import { closeReviewAction, deleteViewAction, reactivateAction, saveViewAction } from "./actions";
import { bulkAction } from "../followups/actions";

export const metadata = { title: "Leads" };

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"];
const FILTER_KEYS = ["stage", "source", "segment", "tier", "owner", "from", "to", "overdue", "tag"] as const;

export default async function LeadsPage(props: { searchParams: Promise<Record<string, string | undefined> & { notice?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const f = searchParams as LeadFilters;
  const [{ rows, total, page, pages, settings }, stageList, sourceList, userList, views, reasons, tpls] = await Promise.all([
    listLeads(db, f),
    db.select().from(stages).orderBy(asc(stages.position)),
    db.select().from(sources).orderBy(asc(sources.id)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)),
    db.select().from(savedViews).where(or(eq(savedViews.userId, user.id), eq(savedViews.shared, true))).orderBy(asc(savedViews.name)),
    db.select().from(lostReasons).orderBy(asc(lostReasons.id)),
    db.select().from(cadenceTemplates).orderBy(asc(cadenceTemplates.id)),
  ]);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...over })) if (v && k !== "notice") p.set(k, v);
    return `?${p.toString()}`;
  };
  const viewQuery = new URLSearchParams(VIEW_KEYS.flatMap((k) => (searchParams[k] ? [[k, searchParams[k]!] as [string, string]] : []))).toString();
  const sortHref = (key: string) => qs({ sort: key, dir: f.sort === key && f.dir !== "asc" ? "asc" : "desc", page: undefined });
  const sortMark = (key: string) => (f.sort === key || (!f.sort && key === "created") ? (f.dir === "asc" ? " ↑" : " ↓") : "");
  const canWrite = can(user.role, "lead:write");
  const view = isViewKey(f.view) ? f.view : null;
  const reviewing = view === "no_decision_review" || view === "nurture_review";
  const activeFilters = FILTER_KEYS.filter((k) => searchParams[k]).length;
  const now = new Date();
  const title = f.deleted === "1" ? "Deleted leads" : view ? VIEWS[view].label : f.tag ? `#${f.tag}` : "Leads";

  return (
    <>
      <PageHeader
        eyebrow={view ? "Smart view" : "Work"}
        title={title}
        subtitle={
          <>
            <span className="num">{total}</span> {total === 1 ? "lead" : "leads"}
            {view && <span className="block text-xs">{VIEWS[view].help}</span>}
          </>
        }
        actions={
          <>
            {canWrite && (
              <Link href="/leads/import" className="btn btn-secondary btn-sm">
                <Icon name="upload" size={14} /> Import
              </Link>
            )}
            {can(user.role, "lead:export") && (
              <a href={`/leads/export${qs({ page: undefined })}`} className="btn btn-secondary btn-sm">
                <Icon name="download" size={14} /> Export CSV
              </a>
            )}
            {can(user.role, "lead:delete") && (
              <Link href={f.deleted === "1" ? "/leads" : "/leads?deleted=1"} className="btn btn-ghost btn-sm">
                <Icon name="trash" size={14} /> {f.deleted === "1" ? "Live leads" : "Deleted"}
              </Link>
            )}
          </>
        }
      />
      <Flash notice={searchParams.notice} />

      {/* views: smart ones and saved ones */}
      <nav aria-label="Views" className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href="/leads" className={`chip px-3 py-1 text-xs ${!view && !viewQuery ? "chip-brand" : "hover:text-fg"}`}>
          All
        </Link>
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => (
          <Link key={k} href={`/leads?view=${k}`} aria-current={view === k ? "page" : undefined} className={`chip px-3 py-1 text-xs ${view === k ? "chip-brand" : "hover:text-fg"}`}>
            <Icon name={VIEWS[k].icon} size={12} /> {VIEWS[k].label}
          </Link>
        ))}
        {views.map((v) => (
          <span key={v.id} className="chip py-0 pl-3 pr-1 text-xs">
            <Link href={`/leads?${new URLSearchParams(v.filters).toString()}`} className="py-1 hover:text-fg" dir="auto">
              {v.name}
            </Link>
            {canWrite && (v.userId === user.id || user.role === "owner") && (
              <form action={deleteViewAction}>
                <input type="hidden" name="id" value={v.id} />
                <button className="grid h-5 w-5 place-items-center rounded-full hover:bg-danger/15 hover:text-danger" aria-label={`Delete view ${v.name}`}>
                  <Icon name="x" size={11} />
                </button>
              </form>
            )}
          </span>
        ))}
      </nav>

      <form className="card mb-4 p-3" method="get">
        {f.deleted === "1" && <input type="hidden" name="deleted" value="1" />}
        {view && <input type="hidden" name="view" value={view} />}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search</span>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input id="search" name="q" defaultValue={f.q} placeholder="Search name, phone, email, city, notes…" dir="auto" className="input pl-9" />
            <kbd className="kbd absolute right-2 top-1/2 -translate-y-1/2">/</kbd>
          </label>
          <button className="btn btn-primary">Search</button>
          {(viewQuery || f.q) && (
            <Link href="/leads" className="btn btn-ghost">
              Clear
            </Link>
          )}
        </div>
        <details className="mt-2" open={activeFilters > 0}>
          <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
            <Icon name="filter" size={13} /> Filters {activeFilters > 0 && <span className="count bg-brand/15 text-accent">{activeFilters}</span>}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select name="stage" defaultValue={f.stage ?? ""} className="input" aria-label="Stage">
              <option value="">All stages</option>
              {stageList.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select name="source" defaultValue={f.source ?? ""} className="input" aria-label="Source">
              <option value="">All sources</option>
              {sourceList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select name="segment" defaultValue={f.segment ?? ""} className="input" aria-label="Segment">
              <option value="">All segments</option>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {pretty(s)}
                </option>
              ))}
            </select>
            <select name="tier" defaultValue={f.tier ?? ""} className="input" aria-label="Tier interest">
              <option value="">All tiers</option>
              {TIERS.map((s) => (
                <option key={s} value={s}>
                  {pretty(s)}
                </option>
              ))}
            </select>
            <select name="owner" defaultValue={f.owner ?? ""} className="input" aria-label="Owner">
              <option value="">Any owner</option>
              <option value="none">Unassigned</option>
              {userList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <input name="tag" defaultValue={f.tag} placeholder="Tag" aria-label="Tag" className="input" />
            <label className="field">
              Created from
              <input type="date" name="from" defaultValue={f.from} className="input" />
            </label>
            <label className="field">
              Created to
              <input type="date" name="to" defaultValue={f.to} className="input" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="overdue" value="1" className="check" defaultChecked={f.overdue === "1"} /> Overdue follow-up
            </label>
          </div>
        </details>
      </form>

      {canWrite && viewQuery && (
        <form action={saveViewAction} className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="query" value={viewQuery} />
          <input name="name" required maxLength={60} placeholder="Save this view as…" aria-label="View name" dir="auto" className="input input-sm w-56" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" name="shared" className="check" /> share with the team
          </label>
          <button className="btn btn-secondary btn-sm">
            <Icon name="plus" size={13} /> Save view
          </button>
        </form>
      )}

      <form action={bulkAction}>
        {canWrite && f.deleted !== "1" && !reviewing && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface/70 px-3 py-2 text-xs">
            <span className="eyebrow">With selected</span>
            <span className="flex items-center gap-1">
              <select name="stage" className="input input-sm w-auto" aria-label="Stage">
                <option value="">Stage…</option>
                {stageList
                  .filter((s) => s.kind !== "won")
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
              </select>
              <select name="lostReasonId" className="input input-sm w-auto" aria-label="Lost reason (if Lost)">
                <option value="">Lost reason…</option>
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button name="op" value="stage" className="btn btn-secondary btn-sm">
                Move
              </button>
            </span>
            <span className="flex items-center gap-1">
              <select name="ownerId" className="input input-sm w-auto" aria-label="Owner">
                <option value="">Unassigned</option>
                {userList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button name="op" value="owner" className="btn btn-secondary btn-sm">
                Assign
              </button>
            </span>
            <span className="flex items-center gap-1">
              <select name="templateId" className="input input-sm w-auto" aria-label="Cadence">
                <option value="">Cadence…</option>
                {tpls.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button name="op" value="cadence" className="btn btn-secondary btn-sm">
                Start cadence
              </button>
            </span>
          </div>
        )}
        <div className="card overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                {canWrite && !reviewing && (
                  <th className="w-10">
                    <SelectAll />
                  </th>
                )}
                <th>
                  <Link href={sortHref("name")} className="hover:text-fg">
                    Name{sortMark("name")}
                  </Link>
                </th>
                <th>
                  <Link href={sortHref("stage")} className="hover:text-fg">
                    Stage{sortMark("stage")}
                  </Link>
                </th>
                <th>Source</th>
                <th>Owner</th>
                <th className="whitespace-nowrap">Next follow-up</th>
                <th>
                  <Link href={sortHref("created")} className="hover:text-fg">
                    Created{sortMark("created")}
                  </Link>
                </th>
                <th className="w-px">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const h = healthOf(l, settings, now);
                const wait = l.stageKind === "open" ? speedBadge(l.createdAt, l.firstContactAt, now, settings) : null;
                return (
                  <tr key={l.id}>
                    {canWrite && !reviewing && (
                      <td>
                        <input type="checkbox" name="ids" value={l.id} className="check" aria-label={`Select ${l.fullName}`} />
                      </td>
                    )}
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={l.fullName} size={30} />
                        <div className="min-w-0">
                          <Link href={`/leads/${l.id}`} className="font-medium hover:text-accent" dir="auto">
                            {l.fullName}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            {l.phone && (
                              <span className="num text-xs text-muted" dir="ltr">
                                {l.phone}
                              </span>
                            )}
                            {wait && (
                              <span className={`chip ${wait.level === "red" ? "chip-danger" : wait.level === "amber" ? "chip-warn" : "chip-ok"}`}>{formatMinutes(wait.minutes)} waiting</span>
                            )}
                            {h.neglected && <span className="chip chip-warn">neglected</span>}
                            {h.stale && <span className="chip chip-warn">stale</span>}
                            {h.noNextStep && <span className="chip chip-danger">no next step</span>}
                            {l.tags.slice(0, 3).map((t) => (
                              <span key={t} className="chip">
                                #{t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={`chip ${l.stageKind === "won" ? "chip-ok" : l.stageKind === "lost" ? "chip-danger" : l.stageKind === "open" ? "chip-brand" : ""}`}>{l.stageLabel}</span>
                      <span className="num ml-1.5 text-xs text-muted">{h.daysInStage}d</span>
                    </td>
                    <td className="whitespace-nowrap text-muted">{l.source ?? "—"}</td>
                    <td className="text-muted">{l.owner ?? "—"}</td>
                    <td className="num whitespace-nowrap">{l.nextFollowUp ? formatCairo(new Date(l.nextFollowUp), false) : <span className="text-muted">—</span>}</td>
                    <td className="num whitespace-nowrap text-muted">{formatCairo(l.createdAt, false)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {reviewing && canWrite ? (
                          <>
                            <button formAction={reactivateAction} name="id" value={l.id} className="btn btn-secondary btn-sm" title="Back to Nurture with a follow-up in 7 days">
                              Reactivate
                            </button>
                            <input type="hidden" name="back" value={`/leads?view=${view}`} />
                            <button formAction={closeReviewAction} name="id" value={l.id} className="btn btn-ghost btn-sm">
                              Close
                            </button>
                          </>
                        ) : (
                          canWrite && <ComposeButton leadId={l.id} phone={l.phone} doNotContact={l.doNotContact} label="" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon={view ? VIEWS[view].icon : "search"} title={view ? "Nothing here. Nice." : "No leads match."}>
                      {view ? VIEWS[view].help : "Try fewer filters, or search by part of a name or number."}
                    </EmptyState>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={qs({ page: String(page - 1) })} className="btn btn-secondary btn-sm">
              <Icon name="chevronLeft" size={14} /> Prev
            </Link>
          )}
          <span className="num px-2 text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={qs({ page: String(page + 1) })} className="btn btn-secondary btn-sm">
              Next <Icon name="chevronRight" size={14} />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
