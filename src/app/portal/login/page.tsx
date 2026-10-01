import { redirect } from "next/navigation";
import { getStudent } from "@/lib/student-auth";
import { LoginForm } from "../forms";
import { PortalShell } from "../Shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student portal · OrlaDent Camp", robots: { index: false } };

export default async function PortalLogin() {
  if (await getStudent()) redirect("/portal");
  return (
    <PortalShell>
      <div className="mx-auto max-w-sm">
        <h1 className="page-title mb-2">Sign in</h1>
        <p className="mb-6 text-sm text-muted">
          Your classes, assignments, feedback and certificate.{" "}
          <span dir="rtl" lang="ar" className="block">
            حصصك وواجباتك والتقييم والشهادة.
          </span>
        </p>
        <LoginForm />
        <p className="mt-6 text-xs text-muted">No password yet? OrlaDent sends you a link on WhatsApp to set one. · لا توجد كلمة مرور؟ سنرسل لك رابطًا على واتساب.</p>
      </div>
    </PortalShell>
  );
}
