import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { listAudit } from "@/lib/audit-log";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Audit log · Settings" };
const field = "rounded border border-line bg-surface px-2 py-1.5 text-sm";

export default async function AuditPage(props: { searchParams: Promise<{ entity?: string; user?: string; page?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("audit:read");
  const userId = searchParams.user && /^\d+$/.test(searchParams.user) ? Number(searchParams.user) : undefined;
  const page = searchParams.page && /^\d+$/.test(searchParams.page) ? Number(searchParams.page) : 1;
  const [{ rows, total, pages, entities }, people] = await Promise.all([
    listAudit(db, { entity: searchParams.entity || undefined, userId, page }),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
  ]);
  const qs = (p: number) => {
    const q = new URLSearchParams();
    if (searchParams.entity) q.set("entity", searchParams.entity);
    if (searchParams.user) q.set("user", searchParams.user);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  return (
    <>
      <p className="mb-3 max-w-2xl text-sm text-muted">
        Who did what and when. It records the kind of change and ids, not lead names, phone numbers or message text.
      </p>
      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Entity
          <select name="entity" defaultValue={searchParams.entity ?? ""} className={field}>
            <option value="">All</option>
            {entities.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          User
          <select name="user" defaultValue={searchParams.user ?? ""} className={field}>
            <option value="">All</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Filter</button>
        <span className="py-1.5 text-sm text-muted">{total} entries</span>
      </form>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Audit log, newest first</caption>
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">When (Cairo)</th>
              <th scope="col" className="px-3 py-2">User</th>
              <th scope="col" className="px-3 py-2">Entity</th>
              <th scope="col" className="px-3 py-2">Action</th>
              <th scope="col" className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-2 text-muted">{formatCairo(r.at)}</td>
                <td className="px-3 py-2">{r.user ?? <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">
                  {r.entity}
                  {r.entityId ? ` #${r.entityId}` : ""}
                </td>
                <td className="px-3 py-2">{r.action.replace(/_/g, " ")}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted" dir="ltr">
                  {r.diff ? JSON.stringify(r.diff) : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  Nothing logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link href={qs(page - 1)}>← Newer</Link>}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={qs(page + 1)}>Older →</Link>}
        </div>
      )}
    </>
  );
}
