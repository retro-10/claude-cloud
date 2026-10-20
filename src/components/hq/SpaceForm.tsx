import { archiveListAction, saveListAction, saveSpaceAction } from "@/app/(app)/hq/actions";
import { COLORS, DEFAULT_STATUSES, SPACE_ICONS, STATUS_GROUPS, type SpaceStatus } from "@/lib/hq";
import { ConfirmButton } from "../ConfirmButton";
import { Card } from "../ui";
import { Dot } from "./bits";

const COLOR_LABEL: Record<string, string> = { slate: "Grey", brand: "Indigo", info: "Blue", ok: "Green", warn: "Amber", danger: "Red", pink: "Pink", teal: "Teal" };
const ICON_LABEL: Record<string, string> = { layers: "Layers", leads: "People", cohorts: "Academy", sparkle: "Spark", target: "Target", trend: "Growth", settings: "Gear", user: "Person", calendar: "Calendar", flag: "Flag" };

/**
 * Create or edit a space: its name, look, and the statuses its tasks move through. Clearing a status's name removes
 * it; its tasks move to another status of the same group.
 */
export function SpaceForm({ space, back }: { space?: { id: number; name: string; description: string | null; color: string; icon: string; statuses: SpaceStatus[] }; back: string }) {
  const rows = [...(space?.statuses ?? DEFAULT_STATUSES), ...Array.from({ length: 3 }, () => null)];
  return (
    <form action={saveSpaceAction} className="flex flex-col gap-6">
      {space && <input type="hidden" name="id" value={space.id} />}
      <input type="hidden" name="back" value={back} />
      <Card title="Space" icon="layers">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="field md:col-span-2">
            Name
            <input name="name" required maxLength={60} defaultValue={space?.name} className="input" placeholder="e.g. Academy" />
          </label>
          <label className="field md:col-span-2">
            What it is for (optional)
            <textarea name="description" rows={2} maxLength={400} defaultValue={space?.description ?? ""} className="input" />
          </label>
          <label className="field">
            Colour
            <select name="color" defaultValue={space?.color ?? "brand"} className="input">
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {COLOR_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Icon
            <select name="icon" defaultValue={space?.icon ?? "layers"} className="input">
              {SPACE_ICONS.map((c) => (
                <option key={c} value={c}>
                  {ICON_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>
      <Card title="Statuses" icon="flow">
        <p className="mb-4 text-sm text-muted">
          The steps a task moves through, left to right on the board. Not started and In progress keep a task open; a Done status finishes it. Clear a name to remove that status; the empty rows add new ones.
        </p>
        <div className="flex flex-col gap-2">
          {rows.map((s, i) => (
            <fieldset key={s?.key ?? `new-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_160px_130px]">
              <legend className="sr-only">{s ? `Status ${s.label}` : "New status"}</legend>
              <Dot color={s?.color ?? "slate"} size={10} ring={!s || s.group === "todo"} />
              <input type="hidden" name="status_key" value={s?.key ?? ""} />
              <input name="status_label" aria-label="Status name" defaultValue={s?.label ?? ""} maxLength={40} placeholder="New status" className="input input-sm" />
              <select name="status_group" aria-label="Group" defaultValue={s?.group ?? "active"} className="input input-sm col-start-2 sm:col-start-auto">
                {STATUS_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
              <select name="status_color" aria-label="Colour" defaultValue={s?.color ?? "slate"} className="input input-sm col-start-2 sm:col-start-auto">
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {COLOR_LABEL[c]}
                  </option>
                ))}
              </select>
            </fieldset>
          ))}
        </div>
      </Card>
      <div className="flex justify-end">
        <button className="btn btn-primary">{space ? "Save space" : "Create space"}</button>
      </div>
    </form>
  );
}

export function ListsCard({ spaceId, lists, back }: { spaceId: number; lists: { id: number; name: string; description: string | null; open: number }[]; back: string }) {
  return (
    <Card title="Lists" icon="list">
      <ul className="flex flex-col gap-3">
        {lists.map((l) => (
          <li key={l.id} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-end">
            <form action={saveListAction} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="spaceId" value={spaceId} />
              <input type="hidden" name="back" value={back} />
              <label className="field flex-1">
                Name
                <input name="name" defaultValue={l.name} required maxLength={80} className="input input-sm" />
              </label>
              <label className="field flex-[2]">
                Description
                <input name="description" defaultValue={l.description ?? ""} maxLength={400} className="input input-sm" />
              </label>
              <button className="btn btn-secondary btn-sm">Save</button>
            </form>
            <form action={archiveListAction}>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="back" value={back} />
              <ConfirmButton className="btn btn-ghost btn-sm" message={`Archive the list “${l.name}”? Its ${l.open} open tasks leave the space views (they stay on people's own task lists).`}>
                Archive
              </ConfirmButton>
            </form>
          </li>
        ))}
        {!lists.length && <li className="text-sm text-muted">No lists yet.</li>}
      </ul>
      <form action={saveListAction} className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-end">
        <input type="hidden" name="spaceId" value={spaceId} />
        <input type="hidden" name="back" value={back} />
        <label className="field flex-1">
          New list
          <input name="name" required maxLength={80} className="input input-sm" placeholder="e.g. Hiring an instructor" />
        </label>
        <button className="btn btn-primary btn-sm">Add list</button>
      </form>
    </Card>
  );
}
