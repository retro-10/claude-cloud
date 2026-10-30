import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { TwoFactorGate } from "@/components/employee/TwoFactorGate";
import { Flash } from "@/components/Flash";
import { Card, Icon, PageHeader } from "@/components/ui";
import { DOC_CATEGORIES, getDocument, logRecordView, type DocCategory } from "@/lib/employees";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { acknowledgeDocumentAction } from "../../actions";

export const metadata = { title: "Document · My portal" };

export default async function DocumentPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id: raw }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("employee:self");
  if (!user.twoFactor) return <TwoFactorGate title="Document" />;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const manage = can(user.role, "employee:manage");
  const d = await getDocument(db, id, { id: user.id, role: user.role, manage });
  if (!d) notFound();
  const mine = d.userId === user.id;
  if (!mine) await logRecordView(db, user.id, d.userId);
  const back = mine ? "/me" : `/employees/${d.userId}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={back} className="hover:text-fg">
            {mine ? "My portal" : "Employee record"}
          </Link>
        }
        title={d.title}
        titleDir="auto"
        subtitle={`${DOC_CATEGORIES[d.category as DocCategory] ?? d.category} · version ${d.version} · added ${formatCairo(d.createdAt, false)}`}
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="The document" icon="note">
          {d.status !== "current" && (
            <p role="status" className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              A newer version replaces this one. It stays here for the record.
            </p>
          )}
          {d.file ? (
            <a href={`/files/${d.file.id}?download=1`} className="btn btn-secondary btn-sm">
              <Icon name="download" size={14} /> Download {d.file.fileName}
            </a>
          ) : (
            <p className="text-sm text-muted">The file is missing.</p>
          )}
          {d.needsAck && (
            <div className="mt-5 border-t border-line pt-4 text-sm">
              {d.acknowledgedAt ? (
                <p className="text-ok">
                  <Icon name="check" size={14} className="-mt-0.5 mr-1 inline" />
                  {mine ? "You" : "They"} read and accepted version {d.version} on {formatCairo(d.acknowledgedAt)}.
                </p>
              ) : mine && d.status === "current" ? (
                <form action={acknowledgeDocumentAction} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={d.id} />
                  <label className="flex items-start gap-2">
                    <input type="checkbox" required className="check mt-0.5" /> I have read this document and accept it.
                  </label>
                  <button className="btn btn-primary btn-sm self-start">Record my acceptance</button>
                  <p className="text-xs text-muted">The app keeps who accepted, when, and which version.</p>
                </form>
              ) : (
                <p className="text-muted">{d.status === "current" ? "Not accepted yet." : "This version was never accepted."}</p>
              )}
            </div>
          )}
        </Card>
        <Card title="Versions" icon="history">
          <ol className="flex flex-col gap-2 text-sm">
            {d.history.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                {v.id === d.id ? (
                  <span className="font-medium">Version {v.version} (this one)</span>
                ) : (
                  <Link href={`/me/documents/${v.id}`} className="link">
                    Version {v.version}
                  </Link>
                )}
                <span className="text-xs text-muted">{formatCairo(v.createdAt, false)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
