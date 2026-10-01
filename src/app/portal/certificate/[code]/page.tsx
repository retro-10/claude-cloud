import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { Certificate } from "@/components/programme/Certificate";
import { PrintButton } from "@/components/programme/PrintButton";
import { ownCertificate } from "@/lib/portal-data";
import { publicBaseUrl } from "@/lib/public-url";
import { requireStudent } from "@/lib/student-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your certificate · OrlaDent Camp", robots: { index: false } };

// Only the signed-in student's own certificate.
export default async function MyCertificate(props: { params: Promise<{ code: string }> }) {
  const me = await requireStudent();
  const c = await ownCertificate(db, me.leadId, decodeURIComponent((await props.params).code));
  if (!c) notFound();
  return (
    <main id="main" className="min-h-screen bg-raised/40 p-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[1000px] items-center justify-between print:hidden">
        <Link href="/portal" className="link text-sm">
          Back to the portal
        </Link>
        <PrintButton />
      </div>
      <Certificate c={c} verifyUrl={`${await publicBaseUrl()}/c/${c.code}`} />
    </main>
  );
}
