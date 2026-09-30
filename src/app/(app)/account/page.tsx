import { Flash } from "@/components/Flash";
import { MIN_PASSWORD } from "@/lib/settings";
import { requireUser } from "@/lib/server-auth";
import { changePasswordAction } from "../settings/actions";

export const metadata = { title: "My account" };
const box = "input";

export default async function AccountPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  return (
    <>
      <h1 className="mb-1 font-display text-2xl">My account</h1>
      <p className="mb-4 text-sm text-muted">
        {user.name} · <span dir="ltr">{user.email}</span> · {user.role}
      </p>
      <Flash {...searchParams} />
      <form action={changePasswordAction} className="flex max-w-sm flex-col gap-3 card p-5">
        <h2 className="font-display text-lg font-semibold">Change password</h2>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Current password
          <input name="current" type="password" required autoComplete="current-password" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          New password (min {MIN_PASSWORD} characters)
          <input name="next" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Repeat new password
          <input name="confirm" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={box} />
        </label>
        <button className="btn btn-primary self-start">Change password</button>
        <p className="text-xs text-muted">You will be signed out everywhere and asked to sign in again.</p>
      </form>
    </>
  );
}
