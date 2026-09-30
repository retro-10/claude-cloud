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
      className="btn btn-primary mt-2 h-11 text-[15px]"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="field">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          dir="auto"
          className="input h-11 text-[15px]"
        />
      </label>
      <label className="field">
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input h-11 text-[15px]"
        />
      </label>
      {state?.error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state?.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
