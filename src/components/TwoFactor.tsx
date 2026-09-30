"use client";

import { useActionState } from "react";
import { confirmTwoFactorAction, disableTwoFactorAction, newRecoveryCodesAction, type TwoFactorState } from "@/app/(app)/account/actions";
import { Icon } from "./ui/Icon";

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 p-4">
      <p className="text-sm font-medium">Your recovery codes. Save them now: they are shown only once.</p>
      <p className="mt-1 text-xs text-muted">Each one signs you in once if you lose your phone. Keep them somewhere safe, not on the same phone.</p>
      <ul className="num mt-3 grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>
          <Icon name="copy" size={14} /> Copy all
        </button>
        <a href="/account" className="btn btn-primary btn-sm">
          <Icon name="check" size={14} /> I&rsquo;ve saved them
        </a>
      </div>
    </div>
  );
}

function Result({ state }: { state: TwoFactorState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" className="text-sm text-ok">
          {state.done}
        </p>
      )}
      {state.recoveryCodes && <Codes codes={state.recoveryCodes} />}
    </>
  );
}

function CodeField({ label = "6-digit code from the app" }: { label?: string }) {
  return (
    <label className="field">
      {label}
      <input name="code" required autoComplete="one-time-code" maxLength={20} className="input num w-40 tracking-[0.2em]" />
    </label>
  );
}

/** Setup step 2: type the first code; the recovery codes come back once. */
export function ConfirmTwoFactor() {
  const [state, action] = useActionState<TwoFactorState, FormData>(confirmTwoFactorAction, {});
  if (state.recoveryCodes) return <Result state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <CodeField />
      <Result state={state} />
      <button className="btn btn-primary btn-sm self-start">Turn on</button>
    </form>
  );
}

/** When it is on: new recovery codes, or turn it off. Both ask for a current code. */
export function ManageTwoFactor() {
  const [codesState, codesAction] = useActionState<TwoFactorState, FormData>(newRecoveryCodesAction, {});
  const [offState, offAction] = useActionState<TwoFactorState, FormData>(disableTwoFactorAction, {});
  if (offState.done) return <Result state={offState} />;
  return (
    <div className="flex flex-col gap-5">
      <form action={codesAction} className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">New recovery codes</h3>
        <CodeField label="Code from the app (or a recovery code)" />
        <Result state={codesState} />
        <button className="btn btn-secondary btn-sm self-start">Make new codes</button>
      </form>
      <form action={offAction} className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-medium">Turn two-factor off</h3>
        <CodeField label="Code from the app (or a recovery code)" />
        <Result state={offState} />
        <button className="btn btn-danger btn-sm self-start">Turn off</button>
      </form>
    </div>
  );
}
