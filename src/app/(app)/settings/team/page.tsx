import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState } from "@/components/ui";
import type { teamMembers } from "@/db/schema";
import { TEAM_GROUPS, TEAM_ROLES, TEAM_STATUS, listTeamFull } from "@/lib/programme";
import { requirePageCan } from "@/lib/server-auth";
import { saveTeamMemberAction } from "./actions";

export const metadata = { title: "Team · Settings" };

type Member = typeof teamMembers.$inferSelect;

function Pick({ name, list, value, empty }: { name: string; list: readonly string[]; value?: string | null; empty?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="input input-sm">
      {empty !== undefined && <option value="">{empty}</option>}
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function MemberForm({ m }: { m?: Member }) {
  return (
    <form action={saveTeamMemberAction} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {m && <input type="hidden" name="id" value={m.id} />}
      <label className="field">
        Name
        <input name="name" required maxLength={200} defaultValue={m?.name} dir="auto" className="input input-sm" />
      </label>
      <label className="field">
        Contact (email)
        <input name="contact" type="email" defaultValue={m?.contact ?? ""} dir="ltr" className="input input-sm" />
      </label>
      <label className="field">
        Role
        <Pick name="role" list={TEAM_ROLES} value={m?.role} empty="—" />
      </label>
      <label className="field">
        Group
        <Pick name="group" list={TEAM_GROUPS} value={m?.group} empty="—" />
      </label>
      <label className="field">
        Status
        <Pick name="status" list={TEAM_STATUS} value={m?.status ?? "Active"} />
      </label>
      <label className="field sm:col-span-2">
        Duties
        <textarea name="duties" rows={2} defaultValue={m?.duties ?? ""} dir="auto" className="input input-sm" />
      </label>
      <div className="flex justify-end sm:col-span-2">
        <button className="btn btn-primary btn-sm">{m ? "Save" : "Add team member"}</button>
      </div>
    </form>
  );
}

export default async function TeamSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const team = await listTeamFull(db);

  return (
    <>
      <Flash {...sp} />
      <p className="mb-4 max-w-3xl text-sm text-muted">
        The people costs are paid to (salaries, freelancers). Kept in step with the Notion <em>Team</em> database. Salary, equity, payment schedule and
        compensation notes stay in Notion only: edit them there. Nobody is deleted here; mark them Inactive so past costs still show who was paid.
      </p>
      <div className="grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[1fr_22rem]">
        <Card title={`Team (${team.length})`} icon="user" bodyClass="p-0">
          {team.length === 0 ? (
            <EmptyState icon="user" title="No team members yet">
              Add them here, or in Notion (they arrive on the next sync).
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {team.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {m.name}
                      </span>
                      {m.role && <span className="text-xs text-muted">{m.role}</span>}
                      {m.group && <span className="chip">{m.group}</span>}
                      <span className={`chip ${m.status === "Inactive" ? "" : "chip-ok"}`}>{m.status ?? "Active"}</span>
                    </summary>
                    <div className="pt-3">
                      <MemberForm m={m} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Add a team member" icon="plus">
          <MemberForm />
        </Card>
      </div>
    </>
  );
}
