import QRCode from "qrcode";

type Cert = { code: string; fullName: string; programme: string; batch: string; issuedAt: Date; revokedAt: Date | null };

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }).format(d);

/** The certificate, sized for an A4 landscape page. The QR code opens its public check. */
export async function Certificate({ c, verifyUrl }: { c: Cert; verifyUrl: string }) {
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return (
    <article className="certificate relative mx-auto flex aspect-[297/210] w-full max-w-[1000px] flex-col justify-between overflow-hidden rounded-xl border-[6px] border-double border-brand/60 bg-white p-[5%] text-[#16141f] print:max-w-none print:rounded-none" aria-label={`Certificate for ${c.fullName}`}>
      {c.revokedAt && (
        <div className="absolute inset-0 grid place-items-center bg-white/80 text-4xl font-bold uppercase tracking-widest text-[#b42318]" role="status">
          Revoked
        </div>
      )}
      <header className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#5b5870]">OrlaDent Camp</span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#5b5870]">Certificate of completion</span>
      </header>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.25em] text-[#5b5870]">This certifies that</p>
        <h1 className="my-4 font-display text-[clamp(28px,5vw,52px)] font-semibold leading-tight" dir="auto">
          {c.fullName}
        </h1>
        <p className="mx-auto max-w-[70%] text-base text-[#3a3750]">
          has completed the <strong>{c.programme}</strong> programme of OrlaDent Camp ({c.batch}).
        </p>
      </div>
      <footer className="flex items-end justify-between gap-4 text-xs text-[#5b5870]">
        <div>
          <div className="text-sm text-[#16141f]">{fmt(c.issuedAt)}</div>
          <div>Date of issue</div>
        </div>
        <div className="text-right">
          <div className="num text-sm text-[#16141f]">{c.code}</div>
          <div>Check it at {verifyUrl.replace(/^https?:\/\//, "")}</div>
        </div>
        <div className="h-20 w-20 shrink-0" role="img" aria-label="QR code to check this certificate" dangerouslySetInnerHTML={{ __html: qr }} />
      </footer>
    </article>
  );
}
