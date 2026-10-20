"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { verify2fa, type LoginState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary mt-2 h-11 text-[15px]">
      {pending ? "Checking…" : "Continue"}
    </button>
  );
}

export function VerifyForm() {
  const [state, action] = useActionState<LoginState, FormData>(verify2fa, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="field">
        Code from your authenticator app
        <input name="code" required autoComplete="one-time-code" inputMode="text" autoFocus maxLength={20} className="input num h-11 text-center text-[18px] tracking-[0.3em]" />
      </label>
      <p className="text-xs text-muted">Lost your phone? Enter one of your recovery codes instead (like abcde-fghjk). Each works once.</p>
      {state?.error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
