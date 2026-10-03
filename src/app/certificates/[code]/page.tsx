import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { Certificate } from "@/components/programme/Certificate";
import { PrintButton } from "@/components/programme/PrintButton";
import { certificateByCode } from "@/lib/graduation";
import { publicBaseUrl } from "@/lib/public-url";
import { getCurrentUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate" };

// Staff: the certificate on its own page, ready to print or save as PDF (the browser's print dialog).
export default async function CertificatePrint(props: { params: Promise<{ code: string }> }) {
  if (!(await getCurrentUser())) redirect("/login");
  const c = await certificateByCode(db, decodeURIComponent((await props.params).code));
  if (!c) notFound();
  const base = await publicBaseUrl();
  return (
    <main id="main" className="min-h-screen bg-raised/40 p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[1000px] items-center justify-between print:hidden">
        <a href="/alumni" className="link text-sm">
          Alumni
        </a>
        <PrintButton />
      </div>
      <Certificate c={c} verifyUrl={`${base}/c/${c.code}`} />
    </main>
  );
}
