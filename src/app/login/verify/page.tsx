import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PENDING_2FA_COOKIE, verifyPending2fa } from "@/lib/session";
import { VerifyForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor sign-in" };

export default async function VerifyPage() {
  if (!(await verifyPending2fa((await cookies()).get(PENDING_2FA_COOKIE)?.value))) redirect("/login");
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm animate-rise-in">
        <div className="eyebrow mb-2">One more step</div>
        <h1 className="page-title mb-2">Two-factor sign-in</h1>
        <p className="mb-8 text-sm text-muted">Open your authenticator app and enter the 6-digit code for OrlaDent CRM.</p>
        <VerifyForm />
        <Link href="/login" className="link mt-6 inline-block text-sm">
          Start again
        </Link>
      </div>
    </main>
  );
}
