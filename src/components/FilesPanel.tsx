import { deleteFileAction, uploadFileAction } from "@/app/(app)/files/actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { EmptyState, Icon } from "@/components/ui";
import { ALLOWED_EXT, formatBytes, type AttachmentRow } from "@/lib/attachments";
import { formatCairo } from "@/lib/time";

const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");

/** Files on a lead, a batch or a production case: list, download, add, delete (the uploader or an owner). */
export function FilesPanel({ rows, back, leadId, cohortId, caseId, canWrite, me, isOwner }: { rows: AttachmentRow[]; back: string; leadId?: number; cohortId?: number; caseId?: number; canWrite: boolean; me: number; isOwner: boolean }) {
  return (
    <>
      {rows.length === 0 ? (
        <EmptyState icon="layers" title="No files yet." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Icon name={f.contentType.startsWith("image/") ? "eye" : "download"} className="text-muted" />
              <div className="min-w-0 flex-1">
                <a href={`/files/${f.id}`} className="link break-all text-sm" dir="auto">
                  {f.fileName}
                </a>
                <div className="text-xs text-muted">
                  {formatBytes(f.size)} · {f.uploader ?? "someone"} · {formatCairo(f.createdAt, false)}
                  {f.note ? ` · ${f.note}` : ""}
                </div>
              </div>
              {canWrite && (isOwner || f.uploadedBy === me) && (
                <form action={deleteFileAction}>
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="back" value={back} />
                  <ConfirmButton message={`Delete ${f.fileName}? The file itself is removed; the audit log keeps a record.`} className="btn btn-ghost btn-sm" aria-label={`Delete ${f.fileName}`}>
                    <Icon name="trash" size={14} />
                  </ConfirmButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form action={uploadFileAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="back" value={back} />
          {leadId && <input type="hidden" name="leadId" value={leadId} />}
          {cohortId && <input type="hidden" name="cohortId" value={cohortId} />}
          {caseId && <input type="hidden" name="caseId" value={caseId} />}
          <label className="field min-w-0 flex-1">
            Add a file (up to 8 MB)
            <input type="file" name="file" required accept={ACCEPT} className="input input-sm" />
          </label>
          <label className="field">
            Note (optional)
            <input name="note" maxLength={500} className="input input-sm" />
          </label>
          <button className="btn btn-secondary btn-sm">
            <Icon name="upload" size={14} /> Upload
          </button>
        </form>
      )}
    </>
  );
}
