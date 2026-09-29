"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateLeadAction, type FormResult } from "@/app/(app)/leads/actions";

type Lead = {
  id: number;
  fullName: string;
  phoneWhatsapp: string | null;
  email: string | null;
  city: string | null;
  segment: string | null;
  sourceId: number | null;
  tierInterest: string;
  ownerId: number | null;
  notes: string | null;
};

const SEGMENTS = ["fresh_graduate", "technician", "dentist", "other"];
const TIERS = ["foundation", "freelance_ready", "production_partner", "unsure"];
const pretty = (s: string) => s.replace(/_/g, " ");
const input = "rounded border border-line bg-bg px-2 py-1.5 text-sm disabled:opacity-70";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function LeadForm({
  lead,
  sources,
  owners,
  readOnly,
}: {
  lead: Lead;
  sources: { id: number; label: string }[];
  owners: { id: number; name: string }[];
  readOnly: boolean;
}) {
  const [state, action] = useFormState<FormResult, FormData>(updateLeadAction, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={lead.id} />
      <fieldset disabled={readOnly} className="contents">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <input name="fullName" defaultValue={lead.fullName} required dir="auto" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          WhatsApp
          <input name="phone" defaultValue={lead.phoneWhatsapp ?? ""} dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Email
          <input name="email" type="email" defaultValue={lead.email ?? ""} dir="ltr" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          City
          <input name="city" defaultValue={lead.city ?? ""} dir="auto" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Segment
          <select name="segment" defaultValue={lead.segment ?? ""} className={input}>
            <option value="">—</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Tier interest
          <select name="tierInterest" defaultValue={lead.tierInterest} className={input}>
            {TIERS.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Source
          <select name="sourceId" defaultValue={lead.sourceId ?? ""} className={input}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Owner
          <select name="ownerId" defaultValue={lead.ownerId ?? ""} className={input}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
          Notes
          <textarea name="notes" defaultValue={lead.notes ?? ""} rows={3} dir="auto" className={input} />
        </label>
      </fieldset>
      {!readOnly && (
        <div className="flex items-center gap-3 sm:col-span-2">
          <Save />
          {state?.error && (
            <span role="alert" className="text-sm text-red-500">
              {state?.error}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
