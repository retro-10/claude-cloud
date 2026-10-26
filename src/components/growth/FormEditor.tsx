import { saveFormAction } from "@/app/(app)/growth/actions";
import type { FormRow } from "@/lib/lead-forms";

type Opt = { id: number; label: string };

/** Create or edit a public sign-up form. */
export function FormEditor({ f, campaigns, sources }: { f?: FormRow; campaigns: Opt[]; sources: Opt[] }) {
  const box = (name: keyof FormRow & string, label: string, def: boolean) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={f ? Boolean(f[name]) : def} /> {label}
    </label>
  );
  return (
    <form action={saveFormAction} className="grid gap-3 sm:grid-cols-2">
      {f && <input type="hidden" name="id" value={f.id} />}
      <label className="field sm:col-span-2">
        Title people see
        <input name="title" required maxLength={120} defaultValue={f?.title} dir="auto" className="input" placeholder="Register for the free masterclass" />
      </label>
      <label className="field">
        Address: /f/…
        <input name="slug" required maxLength={40} defaultValue={f?.slug} dir="ltr" className="input num" placeholder="masterclass-oct" />
      </label>
      <label className="field">
        Campaign
        <select name="campaignId" defaultValue={f?.campaignId ?? ""} className="input">
          <option value="">None (or from the link&rsquo;s utm_campaign)</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Lead source
        <select name="sourceId" defaultValue={f?.sourceId ?? ""} className="input">
          <option value="">The campaign&rsquo;s, else &ldquo;Website form&rdquo;</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Also ask for</legend>
        {box("askEmail", "Email", true)}
        {box("askSegment", "Dentist / technician / graduate", true)}
        {box("askTier", "Programme interest", false)}
        {box("askCity", "City", false)}
      </fieldset>
      <label className="field sm:col-span-2">
        Intro (optional)
        <textarea name="intro" rows={3} defaultValue={f?.intro ?? ""} dir="auto" className="input" />
      </label>
      <label className="field sm:col-span-2">
        Thank-you message (optional)
        <textarea name="thankYou" rows={2} defaultValue={f?.thankYou ?? ""} dir="auto" className="input" />
      </label>
      {box("active", "Open: the form accepts sign-ups", true)}
      <div className="sm:col-span-2">
        <button className="btn btn-primary btn-sm">{f ? "Save form" : "Create form"}</button>
      </div>
    </form>
  );
}
