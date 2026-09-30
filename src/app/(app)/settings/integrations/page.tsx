import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon } from "@/components/ui";
import { notionConfig, syncRunning, syncStatus } from "@/lib/notion/sync";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { syncNotionAction } from "./actions";

export const metadata = { title: "Integrations · Settings" };

const notionUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;

export default async function Integrations(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const cfg = notionConfig();
  const st = await syncStatus(db);
  const last = st.runs[0];
  const leadsDb = cfg?.leadsDb ?? st.leadsDb;
  const dbs = cfg
    ? [
        { label: "Batches", id: cfg.batchesDb, n: st.linked.cohort, dir: "both ways" },
        { label: "Candidates", id: cfg.candidatesDb, n: st.linked.enrolment, dir: "both ways" },
        { label: "Ledger", id: cfg.ledgerDb, n: st.linked.ledger, dir: "both ways" },
        ...(cfg.syncLeads ? [{ label: "CRM Leads", id: leadsDb, n: st.linked.lead, dir: "CRM → Notion; name, email, notes back" }] : []),
      ]
    : [];

  return (
    <>
      <Flash {...sp} />
      <Card
        title="Notion"
        icon="layers"
        className="mb-5 max-w-3xl"
        actions={
          cfg ? (
            <form action={syncNotionAction}>
              <button className="btn btn-primary btn-sm" disabled={syncRunning()}>
                <Icon name="history" size={14} /> {syncRunning() ? "Syncing…" : "Sync now"}
              </button>
            </form>
          ) : undefined
        }
      >
        {!cfg ? (
          <EmptyState icon="layers" title="Not connected">
            Create an internal integration at notion.so/my-integrations, share the OrlaDent Camp page with it, and set NOTION_TOKEN on the server (see the User guide). The
            sync starts on the next restart.
          </EmptyState>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              The CRM and Notion stay in step every {Math.max(30, Number(process.env.NOTION_SYNC_INTERVAL_SEC) || 60)} seconds. When the same record changed on both sides, the newer
              edit wins. Payment references stay in the CRM only. Lead stages are changed in the CRM.
            </p>
            <table className="table mb-4">
              <thead>
                <tr>
                  <th>Notion database</th>
                  <th>Direction</th>
                  <th className="text-right">Linked records</th>
                </tr>
              </thead>
              <tbody>
                {dbs.map((d) => (
                  <tr key={d.label}>
                    <td>
                      {d.id ? (
                        <a href={notionUrl(d.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-accent">
                          {d.label} <Icon name="arrowUpRight" size={12} />
                        </a>
                      ) : (
                        <span className="font-medium">{d.label}</span>
                      )}
                      {!d.id && <div className="text-xs text-muted">created on the first sync</div>}
                    </td>
                    <td className="text-muted">{d.dir}</td>
                    <td className="num text-right">{d.n ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-sm">
              {last ? (
                <>
                  Last run {formatCairo(last.startedAt)}
                  {last.finishedAt ? ` · ${Math.max(1, Math.round((last.finishedAt.getTime() - last.startedAt.getTime()) / 1000))}s` : " · still running"}
                </>
              ) : (
                "No sync has run yet."
              )}
            </div>
          </>
        )}
      </Card>

      {st.runs.length > 0 && (
        <Card title="Recent runs" icon="history" bodyClass="p-0" className="max-w-3xl">
          <table className="table">
            <thead>
              <tr>
                <th>Started</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Updated</th>
                <th className="text-right">New</th>
                <th className="text-right">Conflicts</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {st.runs.map((r) => (
                <tr key={r.id}>
                  <td className="num whitespace-nowrap">{formatCairo(r.startedAt)}</td>
                  <td className="num text-right">{r.pushed}</td>
                  <td className="num text-right">{r.pulled}</td>
                  <td className="num text-right">{r.created}</td>
                  <td className="num text-right">{r.conflicts}</td>
                  <td className="text-xs">
                    {r.errors.length === 0 ? (
                      <span className="text-ok">None</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-warn">{r.errors.length} problem(s)</summary>
                        <ul className="mt-1 list-disc pl-4 text-muted">
                          {r.errors.map((e, i) => (
                            <li key={i} dir="auto">
                              {e}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
