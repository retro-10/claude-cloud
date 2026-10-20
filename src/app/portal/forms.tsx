"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptInviteAction, portalLogin, submitWorkAction, type PortalState } from "./actions";

function Send({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary h-11 text-[15px]">
      {pending ? busy : label}
    </button>
  );
}

const Alert = ({ s }: { s: PortalState }) =>
  s.error ? (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {s.error}
    </p>
  ) : null;

export function LoginForm() {
  const [state, action] = useActionState<PortalState, FormData>(portalLogin, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="field">
        <span className="flex justify-between">
          <span>WhatsApp number</span>
          <span dir="rtl" lang="ar">
            رقم الواتساب
          </span>
        </span>
        <input name="phone" type="tel" required autoComplete="username" inputMode="tel" dir="ltr" className="input h-11" placeholder="01x xxxx xxxx" />
      </label>
      <label className="field">
        <span className="flex justify-between">
          <span>Password</span>
          <span dir="rtl" lang="ar">
            كلمة المرور
          </span>
        </span>
        <input name="password" type="password" required autoComplete="current-password" className="input h-11" />
      </label>
      <Alert s={state} />
      <Send label="Sign in · دخول" busy="…" />
    </form>
  );
}

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<PortalState, FormData>(acceptInviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span>New password (at least 10 characters) · كلمة مرور جديدة</span>
        <input name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-11" />
      </label>
      <label className="field">
        <span>Repeat it · أعد كتابتها</span>
        <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input h-11" />
      </label>
      <Alert s={state} />
      <Send label="Set password and continue · حفظ" busy="…" />
    </form>
  );
}

export function SubmitWork({ assignmentId, accept }: { assignmentId: number; accept: string }) {
  const [state, action] = useActionState<PortalState, FormData>(submitWorkAction, {});
  if (state.done)
    return (
      <p role="status" className="text-sm text-ok">
        {state.done}
      </p>
    );
  return (
    <form action={action} className="mt-2 grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label className="field">
        Your file (up to 8 MB) · ملفك
        <input type="file" name="file" accept={accept} className="input input-sm" />
      </label>
      <label className="field">
        or a link (Drive, WeTransfer) · أو رابط
        <input name="link" type="url" dir="ltr" className="input input-sm" placeholder="https://" />
      </label>
      <label className="field sm:col-span-2">
        A note for your instructor (optional) · ملاحظة
        <input name="note" maxLength={500} dir="auto" className="input input-sm" />
      </label>
      <div className="sm:col-span-2">
        <Alert s={state} />
        <button className="btn btn-primary btn-sm mt-2">Send · إرسال</button>
      </div>
    </form>
  );
}
