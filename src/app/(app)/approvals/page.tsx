import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader, Tabs } from "@/components/ui";
import { STATUS_LABEL, allRequests, myRequests, typeOf, waitingFor, type ApprovalRow } from "@/lib/approvals";
import { egp } from "@/lib/cohort-format";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";

export const metadata = { title: "Approvals" };

const TONE: Record<string, string> = { pending: "chip-warn", needs_info: "chip-warn", approved: "chip-ok", rejected: "chip-danger", cancelled: "" };

/** "3 days", "5 hours": how long a request has been waiting. */
function waited(from: Date, now: Date) {
  const h = Math.floor((now.getTime() - from.getTime()) / 3_600_000);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)} days`;
}

function Rows({ rows, now, showWho }: { rows: ApprovalRow[]; now: Date; showWho: boolean }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Request</th>
          {showWho && <th>From</th>}
          <th className="text-right">Amount</th>
          <th>Asked</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>
              <Link href={`/approvals/${r.id}`} className="font-medium hover:text-accent" dir="auto">
                {r.title}
              </Link>
              <div className="text-xs text-muted">
                {typeOf(r.type).label}
                {r.startsOn && ` · ${r.startsOn}${r.endsOn && r.endsOn !== r.startsOn ? ` to ${r.endsOn}` : ""}`}
              </div>
            </td>
            {showWho && <td>{r.requester}</td>}
            <td className="num text-right">{r.amountEgp != null ? egp(r.amountEgp) : ""}</td>
            <td className="whitespace-nowrap text-sm">
              {r.status === "pending" || r.status === "needs_info" ? `${waited(r.createdAt, now)} ago` : formatCairo(r.createdAt, false)}
            </td>
            <td>
              <span className={`chip ${TONE[r.status] ?? ""}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// One queue for every yes the company needs: what waits for me (oldest first), what I asked for, and, for owners
// and finance, everything they may see.
export default async function ApprovalsPage(props: { searchParams: Promise<{ tab?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("approval:submit");
  const viewer = { id: user.id, name: user.name, isOwner: can(user.role, "settings:write"), isFinance: can(user.role, "finance:read") };
  const seeAll = viewer.isOwner || viewer.isFinance;
  const [waiting, mine] = await Promise.all([waitingFor(db, user.id), myRequests(db, user.id)]);
  const tab = sp.tab === "mine" || (sp.tab === "all" && seeAll) ? sp.tab : waiting.length || !mine.length ? "waiting" : "mine";
  const all = tab === "all" ? await allRequests(db, viewer) : [];
  const now = new Date();
  const rows = tab === "waiting" ? waiting : tab === "mine" ? mine : all;
  const href = (t: string) => `/approvals?tab=${t}`;

  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Approvals"
        subtitle="Ask for a yes, and give one. Requests go to the people the routing rules name; nobody approves their own. Every step is recorded."
        actions={
          <Link href="/approvals/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} /> New request
          </Link>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <Tabs
        label="Approvals"
        current={href(tab)}
        items={[
          { href: href("waiting"), label: "Waiting for me", count: waiting.length },
          { href: href("mine"), label: "My requests", count: mine.filter((r) => r.status === "pending" || r.status === "needs_info").length },
          ...(seeAll ? [{ href: href("all"), label: viewer.isOwner ? "All requests" : "All money requests" }] : []),
        ]}
      />
      <Card bodyClass="p-0 overflow-x-auto">
        {rows.length ? (
          <Rows rows={rows} now={now} showWho={tab !== "mine"} />
        ) : (
          <EmptyState icon="check" title={tab === "waiting" ? "Nothing waiting for you" : tab === "mine" ? "You have not asked for anything yet" : "No requests yet"}>
            {tab === "mine" ? "Expenses, purchases, leave and brand requests start with New request." : null}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
