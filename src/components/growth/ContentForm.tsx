import { saveContentAction } from "@/app/(app)/growth/content/actions";
import { FORMATS, PLATFORMS, STATUSES } from "@/lib/content";
import { toCairoLocalInput } from "@/lib/time";

type Item = { id: number; title: string; platform: string; format: string; status: string; ownerId: number | null; publishAt: Date | null; campaignId: number | null; brief: string | null; caption: string | null; postUrl: string | null };
type Opt = { id: number; name?: string; label?: string };

const options = (o: Record<string, string>) =>
  Object.entries(o).map(([k, v]) => (
    <option key={k} value={k}>
      {v}
    </option>
  ));

/** Plan or edit one piece of content. */
export function ContentForm({ c, people, campaigns, me, back, defaultDate }: { c?: Item; people: Opt[]; campaigns: Opt[]; me: number; back: string; defaultDate?: string }) {
  return (
    <form action={saveContentAction} className="grid gap-3 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input type="hidden" name="back" value={back} />
      <label className="field sm:col-span-2">
        Working title
        <input name="title" required maxLength={200} defaultValue={c?.title} dir="auto" className="input" placeholder="e.g. Crown design in 60 seconds" />
      </label>
      <label className="field">
        Platform
        <select name="platform" defaultValue={c?.platform ?? "instagram"} className="input">
          {options(PLATFORMS)}
        </select>
      </label>
      <label className="field">
        Format
        <select name="format" defaultValue={c?.format ?? "reel"} className="input">
          {options(FORMATS)}
        </select>
      </label>
      <label className="field">
        Status
        <select name="status" defaultValue={c?.status ?? "idea"} className="input">
          {options(STATUSES)}
        </select>
      </label>
      <label className="field">
        Publish on
        <input name="publishAt" type="datetime-local" defaultValue={c ? toCairoLocalInput(c.publishAt) : defaultDate ? `${defaultDate}T19:00` : ""} className="input" />
      </label>
      <label className="field">
        Owner
        <select name="ownerId" defaultValue={c?.ownerId ?? me} className="input">
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Campaign
        <select name="campaignId" defaultValue={c?.campaignId ?? ""} className="input">
          <option value="">None</option>
          {campaigns.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field sm:col-span-2">
        Brief (hook, points, call to action)
        <textarea name="brief" rows={4} defaultValue={c?.brief ?? ""} dir="auto" className="input" />
      </label>
      <label className="field sm:col-span-2">
        Caption
        <textarea name="caption" rows={3} defaultValue={c?.caption ?? ""} dir="auto" className="input" />
      </label>
      <label className="field sm:col-span-2">
        Link to the post (once it is live)
        <input name="postUrl" type="url" defaultValue={c?.postUrl ?? ""} dir="ltr" className="input" placeholder="https://" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{c ? "Save" : "Add to the calendar"}</button>
      </div>
    </form>
  );
}
