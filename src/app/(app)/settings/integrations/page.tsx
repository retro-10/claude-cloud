import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon } from "@/components/ui";
import { notionConfig, syncRunning, syncStatus } from "@/lib/notion/sync";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { ConfirmButton } from "@/components/ConfirmButton";
import { demoCounts } from "@/lib/demo-cleanup";
import { fileStoreCounts, formatBytes } from "@/lib/attachments";
import { driveFolderUrl, driveStatus } from "@/lib/drive";
import { KEEP, backupState } from "@/lib/backup";
import { backupNowAction, disconnectDriveAction, moveFilesToDriveAction, removeDemoAction, syncNotionAction } from "./actions";
import { callbackUrl } from "./drive/shared";

export const metadata = { title: "Integrations · Settings" };

const notionUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;

export default async function Integrations(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const cfg = notionConfig();
  const [st, demo, drive, files, redirectUri, backup] = await Promise.all([syncStatus(db), demoCounts(db), driveStatus(db), fileStoreCounts(db), callbackUrl(), backupState(db)]);
  const last = st.runs[0];
  const leadsDb = cfg?.leadsDb ?? st.leadsDb;
  const dbs = cfg
    ? [
        { label: "Batches", id: cfg.batchesDb, n: st.linked.cohort, dir: "both ways" },
        { label: "Candidates", id: cfg.candidatesDb, n: st.linked.enrolment, dir: "both ways" },
        { label: "Ledger", id: cfg.ledgerDb, n: st.linked.ledger, dir: "both ways" },
        { label: "Sessions", id: cfg.sessionsDb, n: st.linked.session, dir: "both ways" },
        { label: "Proof & Testimonial Bank", id: cfg.proofDb, n: st.linked.proof, dir: "both ways" },
        { label: "Team", id: cfg.teamDb, n: st.linked.team, dir: "both ways (pay and equity stay in Notion)" },
        ...(cfg.syncLeads ? [{ label: "Leads", id: leadsDb, n: st.linked.lead, dir: "both ways (add leads in Notion; stage and owner stay the CRM's)" }] : []),
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

      <Card
        title="Google Drive"
        icon="upload"
        className="mb-5 max-w-3xl"
        actions={
          drive.mode === "ready-to-connect" ? (
            <a href="/settings/integrations/drive/connect" className="btn btn-primary btn-sm">
              Connect Google Drive
            </a>
          ) : drive.mode === "oauth" ? (
            <form action={disconnectDriveAction}>
              <ConfirmButton
                message="Disconnect Google Drive? New files will be kept in the database, and files already in Drive can be opened again only after reconnecting the same account."
                className="btn btn-ghost btn-sm"
              >
                Disconnect
              </ConfirmButton>
            </form>
          ) : undefined
        }
      >
        {drive.mode === "off" ? (
          <EmptyState icon="upload" title="Files are kept in the database">
            To keep files in Google Drive instead, create an OAuth client in Google Cloud (see the User guide), set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server and
            restart; a Connect button then appears here.
          </EmptyState>
        ) : drive.mode === "ready-to-connect" ? (
          <p className="text-sm text-muted">
            Connect the Google account whose Drive should keep the files. The app creates a folder there and sees nothing else in that Drive. The OAuth client must list this
            redirect address: <code className="break-all">{redirectUri}</code>
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              {drive.mode === "service" ? "Signed in as the service account " : "Connected to "}
              <span className="font-medium">{drive.email ?? "a Google account"}</span>.{" "}
              {drive.folderId ? (
                <a href={driveFolderUrl(drive.folderId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                  Open the folder <Icon name="arrowUpRight" size={12} />
                </a>
              ) : (
                <span className="text-muted">The folder is created with the first file.</span>
              )}
            </p>
            <p className="text-muted">
              New files are saved in Drive and opened through the app, which checks who may see them. Files are never shared from Drive.
            </p>
          </div>
        )}
        {(files.inDrive > 0 || files.inDatabase > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4 text-sm">
            <span className="flex-1">
              {files.inDrive} file(s) in Google Drive · {files.inDatabase} in the database ({formatBytes(files.databaseBytes)})
            </span>
            {(drive.mode === "oauth" || drive.mode === "service") && files.inDatabase > 0 && (
              <form action={moveFilesToDriveAction}>
                <button className="btn btn-sm">Move them to Drive now</button>
              </form>
            )}
          </div>
        )}
        {(drive.mode === "oauth" || drive.mode === "service") && (
          <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4 text-sm">
            <div className="flex-1">
              <div className="font-medium">Database backups</div>
              <div className="text-muted">
                Once a day to a Backups folder in this Drive; the newest {KEEP} are kept.{" "}
                {backup.lastAt ? `Last: ${formatCairo(new Date(backup.lastAt))} (${formatBytes(backup.lastSize)}).` : "None yet."}
              </div>
              {backup.lastError && backup.lastErrorAt && (!backup.lastAt || backup.lastErrorAt > backup.lastAt) && (
                <div className="text-danger">
                  Last attempt failed {formatCairo(new Date(backup.lastErrorAt))}: {backup.lastError}
                </div>
              )}
            </div>
            <form action={backupNowAction}>
              <button className="btn btn-secondary btn-sm">Back up now</button>
            </form>
          </div>
        )}
      </Card>

      {(demo.leads > 0 || demo.ledger > 0) && (
        <Card title="Demo data" icon="trash" className="mb-5 max-w-3xl border-warn/40">
          <div className="flex flex-wrap items-center gap-4">
            <p className="flex-1 text-sm text-muted">
              This CRM still holds {demo.leads} demo leads (fake &ldquo;Demo Lead&rdquo; names and +20 108 numbers) and {demo.ledger} demo money rows. Remove them before going
              live so only your real leads and Notion&rsquo;s candidates remain. Real data is never touched.
            </p>
            <form action={removeDemoAction}>
              <ConfirmButton message="Delete all demo leads, demo batches and DEMO money rows? This cannot be undone." className="btn btn-danger btn-sm">
                <Icon name="trash" size={14} /> Remove demo data
              </ConfirmButton>
            </form>
          </div>
        </Card>
      )}

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
