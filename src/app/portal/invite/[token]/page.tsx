import Link from "next/link";
import { db } from "@/db";
import { accountByInvite } from "@/lib/portal";
import { SetPasswordForm } from "../../forms";
import { PortalShell } from "../../Shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password · OrlaDent Camp", robots: { index: false }, referrer: "no-referrer" };

export default async function InvitePage(props: { params: Promise<{ token: string }> }) {
  const token = (await props.params).token;
  const a = await accountByInvite(db, token);
  return (
    <PortalShell>
      <div className="mx-auto max-w-sm">
        {a ? (
          <>
            <h1 className="page-title mb-2" dir="auto">
              Welcome, {a.fullName.split(/\s+/)[0]}
            </h1>
            <p className="mb-6 text-sm text-muted">Choose a password for the student portal. Next time, sign in with your WhatsApp number and this password.</p>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <>
            <h1 className="page-title mb-2">This link no longer works</h1>
            <p className="text-sm text-muted">It has expired or was already used. Ask OrlaDent for a new one, or sign in if you already set a password.</p>
            <Link href="/portal/login" className="btn btn-primary mt-6">
              Sign in
            </Link>
          </>
        )}
      </div>
    </PortalShell>
  );
}
