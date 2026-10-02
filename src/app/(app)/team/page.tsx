import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { CADENCES, listResponsibilities } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { deleteResponsibilityAction, saveResponsibilityAction } from "./actions";

export const metadata = { title: "Responsibilities · Team" };

type Row = Awaited<ReturnType<typeof listResponsibilities>>[number];
type Person = { id: number; name: string };

function RespForm({ r, people }: { r?: Row; people: Person[] }) {
  const pick = (name: string, value: number | null | undefined, label: string) => (
    <label className="field">
      {label}
      <select name={name} defaultValue={value ?? ""} className="input input-sm">
        <option value="">Nobody yet</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form action={saveResponsibilityAction} className="grid gap-3 sm:grid-cols-2">
      {r && <input type="hidden" name="id" value={r.id} />}
      <label className="field sm:col-span-2">
        The job
        <input name="area" required maxLength={200} defaultValue={r?.area} dir="auto" className="input input-sm" placeholder="Reply to new leads within 5 minutes" />
      </label>
      <label className="field">
        How often
        <select name="cadence" defaultValue={r?.cadence ?? ""} className="input input-sm">
          <option value="">—</option>
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {pick("responsibleId", r?.responsibleId, "Does it (responsible)")}
      {pick("accountableId", r?.accountableId, "Answers for it (accountable)")}
      <label className="field">
        Consulted
        <input name="consulted" maxLength={300} defaultValue={r?.consulted ?? ""} dir="auto" className="input input-sm" />
      </label>
      <label className="field">
        Kept informed
        <input name="informed" maxLength={300} defaultValue={r?.informed ?? ""} dir="auto" className="input input-sm" />
      </label>
      <label className="field sm:col-span-2">
        Notes
        <input name="notes" maxLength={2000} defaultValue={r?.notes ?? ""} dir="auto" className="input input-sm" />
      </label>
      <button className="btn btn-primary btn-sm justify-self-start">{r ? "Save" : "Add"}</button>
    </form>
  );
}

// Who owns each recurring job, so nothing falls between people (RACI).
export default async function ResponsibilitiesPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const manage = can(user.role, "ops:manage");
  const [rows, people] = await Promise.all([listResponsibilities(db), db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name))]);
  const gaps = rows.filter((r) => r.gap).length;
  return (
    <>
      <PageHeader eyebrow="Team & operations" title="Responsibilities" subtitle="Each recurring job, who does it and who answers for it. A job nobody active does is flagged." />
      <TeamTabs current="/team" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title={`Jobs (${rows.length})`} icon="user" bodyClass="p-0" actions={gaps ? <span className="chip chip-danger">{gaps} without anyone</span> : undefined}>
          {!rows.length ? (
            <EmptyState icon="user" title="No responsibilities written down yet." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium" dir="auto">
                      {r.area}
                    </span>
                    {r.cadence && <span className="chip">{r.cadence}</span>}
                    {r.gap && <span className="chip chip-danger">nobody does this</span>}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    Does it: <span className="text-fg">{r.responsible ?? "—"}</span> · Answers for it: <span className="text-fg">{r.accountable ?? "—"}</span>
                    {r.consulted ? ` · Consulted: ${r.consulted}` : ""}
                    {r.informed ? ` · Informed: ${r.informed}` : ""}
                  </div>
                  {r.notes && (
                    <div className="mt-1 text-xs text-muted" dir="auto">
                      {r.notes}
                    </div>
                  )}
                  {manage && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-muted">Edit</summary>
                      <div className="mt-2 grid gap-3">
                        <RespForm r={r} people={people} />
                        <form action={deleteResponsibilityAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmButton message={`Remove “${r.area}”?`} className="btn btn-ghost btn-sm text-muted">
                            <Icon name="trash" size={14} /> Remove
                          </ConfirmButton>
                        </form>
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manage && (
          <Card title="Add a job" icon="plus">
            <RespForm people={people} />
          </Card>
        )}
      </div>
    </>
  );
}
