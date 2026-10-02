import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { listRuns, type RunRow } from "@/lib/operations";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Checklists · Team" };

function RunList({ rows, empty }: { rows: RunRow[]; empty: string }) {
  if (!rows.length) return <EmptyState icon="check" title={empty} />;
  const now = new Date();
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const late = !r.completedAt && r.dueAt && r.dueAt < now;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/team/runs/${r.id}`} className="link font-medium" dir="auto">
                {r.title}
              </Link>
              <div className="text-xs text-muted">
                {r.assignee ?? "nobody"} · started {formatCairo(r.startedAt, false)}
                {r.dueAt ? ` · due ${formatCairo(r.dueAt, false)}` : ""}
              </div>
            </div>
            <div className="w-32">
              <div className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                <div className="h-full bg-brand" style={{ width: `${Math.round((r.doneSteps / r.steps.length) * 100)}%` }} />
              </div>
              <div className={`mt-1 text-right text-xs ${late ? "font-medium text-danger" : "text-muted"}`}>
                {r.completedAt ? "done" : `${r.doneSteps} of ${r.steps.length}${late ? " · late" : ""}`}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Playbooks being run now, and the ones finished.
export default async function RunsPage(props: { searchParams: Promise<{ notice?: string; error?: string; mine?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const mine = sp.mine === "1";
  const rows = await listRuns(db, mine ? { assigneeId: user.id } : {});
  const open = rows.filter((r) => !r.completedAt);
  const finished = rows.filter((r) => r.completedAt);
  return (
    <>
      <PageHeader eyebrow="Team & operations" title="Checklists" subtitle="Playbooks being run, step by step. Start one from its playbook." />
      <TeamTabs current="/team/runs" />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs label="Whose checklists" current={mine ? "/team/runs?mine=1" : "/team/runs"} items={[{ href: "/team/runs", label: "Everyone" }, { href: "/team/runs?mine=1", label: "Mine" }]} />
      <div className="grid gap-5">
        <Card title={`Running (${open.length})`} icon="flag" bodyClass="p-0">
          <RunList rows={open} empty="Nothing running." />
        </Card>
        <Card title={`Finished (${finished.length})`} icon="check" bodyClass="p-0">
          <RunList rows={finished} empty="None yet." />
        </Card>
      </div>
    </>
  );
}
