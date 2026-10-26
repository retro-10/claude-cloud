import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { DecisionForm } from "@/components/team/DecisionForm";
import { DecisionList } from "@/components/team/DecisionList";
import { TeamTabs } from "@/components/team/TeamTabs";
import { Card, PageHeader, Tabs } from "@/components/ui";
import { listDecisions } from "@/lib/operations";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Decisions · Team" };

// Every decision taken, open first (overdue on top); closed ones keep what happened.
export default async function DecisionsPage(props: { searchParams: Promise<{ notice?: string; error?: string; show?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const manage = can(user.role, "ops:manage");
  const show = sp.show === "closed" ? "closed" : sp.show === "mine" ? "mine" : "open";
  const [rows, people] = await Promise.all([
    listDecisions(db, show === "mine" ? { ownerId: user.id, status: "open" } : { status: show }),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  const here = `/team/decisions${show === "open" ? "" : `?show=${show}`}`;
  return (
    <>
      <PageHeader eyebrow="Team & operations" title="Decisions" subtitle="What was decided, who owns it and by when. Open decisions show in the Command centre until they are closed." />
      <TeamTabs current="/team/decisions" />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs
        label="Show decisions"
        current={here}
        items={[
          { href: "/team/decisions", label: "Open" },
          { href: "/team/decisions?show=mine", label: "Mine" },
          { href: "/team/decisions?show=closed", label: "Closed" },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card bodyClass="p-0">
          <DecisionList rows={rows} me={user.id} manage={manage} back={here} />
        </Card>
        {manage && (
          <Card title="Log a decision" icon="plus">
            <DecisionForm people={people} back={here} />
          </Card>
        )}
      </div>
    </>
  );
}
