"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-gold px-4 py-2 font-medium text-ink disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          dir="auto"
          className="rounded border border-line bg-surface px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded border border-line bg-surface px-3 py-2"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state?.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
