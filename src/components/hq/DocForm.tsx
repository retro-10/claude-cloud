import { saveDocAction } from "@/app/(app)/hq/actions";

type Opt = { id: number; name: string };

/** Write or edit a doc. The body is Markdown: # headings, - lists, - [ ] checklists, **bold**, [links](https://…). */
export function DocForm({ doc, spaces, parents, back, spaceId, parentId, canBrand = false, brand = false }: {
  doc?: { id: number; title: string; body: string; spaceId: number | null; parentId: number | null; wiki: boolean; brand?: boolean };
  canBrand?: boolean; // may mark the page as a brand guideline
  brand?: boolean; // a new page starts as a brand guideline (from the brand hub)
  spaces: Opt[];
  parents: Opt[];
  back: string;
  spaceId?: number;
  parentId?: number;
}) {
  return (
    <form action={saveDocAction} className="flex flex-col gap-4">
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <input type="hidden" name="back" value={back} />
      <label className="sr-only" htmlFor="doc-title">
        Title
      </label>
      <input
        id="doc-title"
        name="title"
        required
        maxLength={140}
        defaultValue={doc?.title}
        placeholder="Untitled"
        className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 font-display text-[30px] font-semibold tracking-tight placeholder:text-faint hover:border-line focus:border-brand/60 focus:outline-none"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field">
          Space
          <select name="spaceId" defaultValue={doc?.spaceId ?? spaceId ?? ""} className="input input-sm">
            <option value="">Whole company</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Inside page (optional)
          <select name="parentId" defaultValue={doc?.parentId ?? parentId ?? ""} className="input input-sm">
            <option value="">Top level</option>
            {parents
              .filter((p) => p.id !== doc?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-muted">
          <input type="checkbox" name="wiki" defaultChecked={doc?.wiki} className="check" /> Wiki: the version to trust
        </label>
        {canBrand && (
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-muted">
            <input type="checkbox" name="brand" defaultChecked={doc?.brand ?? brand} className="check" /> Brand guideline (shown in the brand hub)
          </label>
        )}
      </div>
      <label className="field">
        <span className="flex items-center justify-between">
          Content
          <span className="text-xs font-normal text-muted"># Heading · - list · - [ ] checklist · **bold** · [link](https://…)</span>
        </span>
        <textarea name="body" rows={22} maxLength={100000} defaultValue={doc?.body ?? ""} className="input font-mono text-[13px] leading-6" placeholder="Write here…" />
      </label>
      <div className="flex justify-end gap-2">
        <button className="btn btn-primary">{doc ? "Save doc" : "Create doc"}</button>
      </div>
    </form>
  );
}
