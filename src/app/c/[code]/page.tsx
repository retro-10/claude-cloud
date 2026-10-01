import { db } from "@/db";
import { certificateByCode } from "@/lib/graduation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate check · OrlaDent Camp", robots: { index: false } };

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(d);

// Public: anyone holding a certificate's code (an employer, a clinic) can check it is real. Shows only what the
// certificate itself shows.
export default async function VerifyPage(props: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await props.params).code);
  const c = await certificateByCode(db, code);
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="card w-full max-w-md p-6 animate-rise-in">
        <div className="eyebrow mb-2">OrlaDent Camp · certificate check</div>
        {!c ? (
          <>
            <h1 className="page-title mb-2">Not found</h1>
            <p className="text-sm text-muted">No certificate has the code {code.slice(0, 20)}. Check it was typed exactly as printed (like OC-7K2P-9QX4).</p>
          </>
        ) : c.revokedAt ? (
          <>
            <h1 className="page-title mb-2 text-danger">No longer valid</h1>
            <p className="text-sm">
              Certificate {c.code} was revoked on {fmt(c.revokedAt)}.
            </p>
          </>
        ) : (
          <>
            <h1 className="page-title mb-4 text-ok">Valid certificate</h1>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted">Name</dt>
                <dd className="font-medium" dir="auto">
                  {c.fullName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Programme</dt>
                <dd>{c.programme}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Batch</dt>
                <dd dir="auto">{c.batch}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Issued</dt>
                <dd>{fmt(c.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Code</dt>
                <dd className="num">{c.code}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
