import QRCode from "qrcode";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ConfirmTwoFactor, ManageTwoFactor } from "@/components/TwoFactor";
import { MIN_PASSWORD } from "@/lib/settings";
import { requireUser } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { pendingSetup, twoFactorStatus } from "@/lib/two-factor";
import { changePasswordAction } from "../settings/actions";
import { startTwoFactorAction } from "./actions";

export const metadata = { title: "My account" };
const box = "input";

export default async function AccountPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const tf = await twoFactorStatus(db, user.id);
  const setup = tf.pending ? await pendingSetup(db, user.id) : null;
  // the QR code is drawn here as SVG from our own data: nothing is sent to a third party
  const qr = setup ? await QRCode.toString(setup.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
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

      <section id="two-factor" aria-labelledby="two-factor-title" className="card mt-5 flex max-w-xl scroll-mt-24 flex-col gap-4 p-5">
        <div>
          <h2 id="two-factor-title" className="font-display text-lg font-semibold">
            Two-factor sign-in {tf.enabled && <span className="chip chip-ok ml-2 align-middle">On</span>}
          </h2>
          <p className="mt-1 text-sm text-muted">
            After your password, a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password and similar).
            Someone who learns your password still cannot get in.
          </p>
        </div>
        {tf.enabled ? (
          <>
            <p className="text-sm">
              On since {formatCairo(tf.enabledAt!, false)} · {tf.recoveryLeft} recovery code{tf.recoveryLeft === 1 ? "" : "s"} left
            </p>
            <ManageTwoFactor />
          </>
        ) : setup && qr ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>In your authenticator app, add an account and scan this code.</li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-5">
              <div className="w-44 rounded-lg bg-white p-2" role="img" aria-label="QR code to add OrlaDent CRM to your authenticator app" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="min-w-0 flex-1 text-xs text-muted">
                Can&rsquo;t scan? Enter this key by hand (time-based):
                <code className="num mt-1 block break-all rounded bg-raised px-2 py-1 text-sm text-fg">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                <a href={setup.uri} className="link mt-2 inline-block">
                  Open in an authenticator app on this device
                </a>
              </div>
            </div>
            <ConfirmTwoFactor />
          </>
        ) : (
          <form action={startTwoFactorAction}>
            <button className="btn btn-primary btn-sm">Set up two-factor sign-in</button>
          </form>
        )}
      </section>
    </>
  );
}
