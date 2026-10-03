"use client";

import { useActionState } from "react";
import { createInviteAction, type InviteState } from "@/app/(app)/leads/portal-actions";
import { whatsappPrefill } from "@/lib/templates-render";
import { Icon } from "../ui/Icon";

/** Makes the invite link and shows it once, with a WhatsApp message ready to send. */
export function PortalInvite({ leadId, phone, firstName, label }: { leadId: number; phone: string | null; firstName: string; label: string }) {
  const [state, action] = useActionState<InviteState, FormData>(createInviteAction, {});
  if (state.link) {
    const text = `Hi ${firstName}, here is your OrlaDent Camp student portal. Open this link to set your password (it works once, for 7 days): ${state.link}\nAfter that, sign in with your WhatsApp number at ${new URL(state.link).origin}/portal`;
    const wa = whatsappPrefill(phone, text);
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">Shown once. Send it to the student; it works for 7 days and only once.</p>
        <code className="num break-all rounded bg-raised px-2 py-1.5 text-xs" dir="ltr">
          {state.link}
        </code>
        <div className="flex flex-wrap gap-2">
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="btn btn-wa btn-sm">
              <Icon name="chat" size={14} /> Send on WhatsApp
            </a>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(state.link!)}>
            <Icon name="copy" size={14} /> Copy link
          </button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="leadId" value={leadId} />
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button className="btn btn-secondary btn-sm self-start">{label}</button>
    </form>
  );
}
