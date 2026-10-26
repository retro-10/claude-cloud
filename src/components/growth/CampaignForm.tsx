import { saveCampaignAction } from "@/app/(app)/growth/actions";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUS, type CampaignStats } from "@/lib/campaigns";
import { cairoYmd, toCairoLocalInput } from "@/lib/time";

type Opt = { id: number; label?: string; name?: string };

/** Create or edit a campaign. The link name becomes utm_campaign and the public form address. */
export function CampaignForm({ c, sources, people }: { c?: CampaignStats; sources: Opt[]; people: Opt[] }) {
  return (
    <form action={saveCampaignAction} className="grid gap-3 sm:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <label className="field sm:col-span-2">
        Name
        <input name="label" required maxLength={80} defaultValue={c?.label} className="input" dir="auto" placeholder="e.g. Masterclass, October 2026" />
      </label>
      <label className="field">
        Type
        <select name="kind" defaultValue={c?.kind ?? "masterclass"} className="input">
          {Object.entries(CAMPAIGN_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Status
        <select name="status" defaultValue={c?.status ?? "planned"} className="input">
          {Object.entries(CAMPAIGN_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Lead source
        <select name="sourceId" defaultValue={c?.sourceId ?? ""} className="input">
          <option value="">None</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Owner
        <select name="ownerId" defaultValue={c?.ownerId ?? ""} className="input">
          <option value="">Nobody</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Starts
        <input name="startedAt" type="date" defaultValue={c?.startedAt ? cairoYmd(c.startedAt) : ""} className="input" />
      </label>
      <label className="field">
        Ends
        <input name="endsAt" type="date" defaultValue={c?.endsAt ? cairoYmd(c.endsAt) : ""} className="input" />
      </label>
      <label className="field">
        Event date and time (masterclass, event)
        <input name="eventAt" type="datetime-local" defaultValue={toCairoLocalInput(c?.eventAt)} className="input" />
      </label>
      <label className="field">
        Budget (EGP)
        <input name="budgetEgp" inputMode="numeric" defaultValue={c?.budgetEgp ?? ""} className="input num" />
      </label>
      <label className="field sm:col-span-2">
        Link name (for tracked links and the sign-up form)
        <input name="slug" maxLength={40} defaultValue={c?.slug ?? ""} className="input num" dir="ltr" placeholder="masterclass-oct-2026" pattern="[a-z0-9][a-z0-9\-]{0,38}[a-z0-9]" />
      </label>
      <label className="field sm:col-span-2">
        Notes
        <textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} className="input" dir="auto" />
      </label>
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{c ? "Save campaign" : "Create campaign"}</button>
      </div>
    </form>
  );
}
