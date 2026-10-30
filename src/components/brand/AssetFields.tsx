import Link from "next/link";
import { Icon } from "@/components/ui";
import { ALLOWED_EXT } from "@/lib/attachments";
import { MAX_UPLOAD_MB } from "@/lib/upload-limit";
import { ASSET_TYPES } from "@/lib/brand";

const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");

/** The details of a brand asset: add (with a file or a link) or edit. */
export function AssetFields({ action, a }: { action: (f: FormData) => Promise<void>; a?: { id: number; name: string; type: string; tags: string[]; usageNotes: string | null; version: string | null; url: string | null } }) {
  return (
    <form action={action} className="flex flex-col gap-4">
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          Name
          <input name="name" required maxLength={120} defaultValue={a?.name} dir="auto" className="input" />
        </label>
        <label className="field">
          Kind
          <select name="type" defaultValue={a?.type ?? "logo"} className="input">
            {ASSET_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Version (optional)
          <input name="version" maxLength={40} defaultValue={a?.version ?? ""} placeholder="e.g. 2026" className="input" />
        </label>
        <label className="field">
          Tags (comma separated)
          <input name="tags" maxLength={400} defaultValue={a?.tags.join(", ")} placeholder="camp, core, batch 2" className="input" />
        </label>
      </div>
      <label className="field">
        How to use it (optional)
        <textarea name="usageNotes" rows={3} maxLength={2000} defaultValue={a?.usageNotes ?? ""} placeholder="Where it may and may not be used, minimum size, clear space" className="input min-h-20 py-2" />
      </label>
      {!a && (
        <label className="field">
          File (up to {MAX_UPLOAD_MB} MB)
          <input type="file" name="file" accept={ACCEPT} className="input py-2" />
        </label>
      )}
      <label className="field">
        {a ? "Link" : "Or a link (https://…)"}
        <input name="url" type="url" maxLength={1000} defaultValue={a?.url ?? ""} placeholder="https://drive.google.com/…" dir="ltr" className="input" />
      </label>
      <div className="flex gap-2">
        <button className="btn btn-primary">
          <Icon name={a ? "check" : "upload"} size={15} /> {a ? "Save" : "Add to the library"}
        </button>
        <Link href={a ? `/brand/assets/${a.id}` : "/brand"} className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
