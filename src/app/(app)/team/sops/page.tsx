import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { listSops } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { saveSopAction } from "../actions";

export const metadata = { title: "Playbooks · Team" };

// The SOP library: how things are done here, step by step; each can be started as a checklist.
export default async function SopsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const manage = can(user.role, "ops:manage");
  const rows = await listSops(db);
  return (
    <>
      <PageHeader eyebrow="Team & operations" title="Playbooks" subtitle="How we do the jobs that come back: onboard a student, run a masterclass, close a batch, deliver a case. Start one as a checklist when it is time." />
      <TeamTabs current="/team/sops" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title={`Playbooks (${rows.length})`} icon="list" bodyClass="p-0">
          {!rows.length ? (
            <EmptyState icon="list" title="No playbooks yet." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/team/sops/${s.id}`} className="link font-medium" dir="auto">
                      {s.title}
                    </Link>
                    <div className="text-xs text-muted" dir="auto">
                      {[s.area, `${s.steps.length} steps`, s.purpose].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {s.open > 0 && <span className="chip chip-brand">{s.open} running</span>}
                  {s.done > 0 && <span className="text-xs text-muted">used {s.done}×</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manage && (
          <Card title="Write a playbook" icon="plus">
            <form action={saveSopAction} className="grid gap-3">
              <label className="field">
                Title
                <input name="title" required maxLength={200} dir="auto" className="input input-sm" placeholder="Close a batch" />
              </label>
              <label className="field">
                Area
                <input name="area" maxLength={60} list="sop-areas" className="input input-sm" placeholder="Programme" />
                <datalist id="sop-areas">
                  {["Sales", "Programme", "Production", "Content", "Finance", "Team"].map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                When and why (optional)
                <input name="purpose" maxLength={2000} dir="auto" className="input input-sm" />
              </label>
              <label className="field">
                Steps, one per line
                <textarea name="steps" required rows={8} maxLength={20000} dir="auto" className="input" placeholder={"Send the last-week reminder\nCheck every instalment is in\nMark attendance for the final class\nIssue certificates\nAsk graduates for a testimonial"} />
              </label>
              <button className="btn btn-primary btn-sm justify-self-start">Add playbook</button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
