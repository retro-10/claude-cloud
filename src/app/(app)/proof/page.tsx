import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { listCohorts } from "@/lib/cohorts";
import { PROOF_CONSENT, PROOF_TYPES, listProof, publishable } from "@/lib/programme";
import { requireUser } from "@/lib/server-auth";

export const metadata = { title: "Proof bank" };

const CONSENT_CHIP: Record<string, string> = { Granted: "chip-ok", Asked: "chip-warn", Declined: "chip-danger" };

// The Proof & Testimonial Bank from Notion: what candidates said and showed, and whether it may be used.
// Only items with consent Granted (and the candidate's consent on file) are marked ready to use.
export default async function ProofBank(props: { searchParams: Promise<{ consent?: string; type?: string; batch?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requireUser();
  const [rows, batches, all] = await Promise.all([
    listProof(db, { consent: sp.consent, type: sp.type, cohortId: Number(sp.batch) || undefined }),
    listCohorts(db),
    listProof(db),
  ]);
  const ready = all.filter((r) => publishable(r.p, r.contentConsent)).length;

  return (
    <>
      <PageHeader
        eyebrow="Programme"
        title="Proof bank"
        subtitle="Quotes, QC results and screenshots from candidates. Use an item in content only when it says Ready: consent granted, word for word, no income promises."
      />
      <Flash error={sp.error} notice={sp.notice} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Items" value={all.length} icon="sparkle" />
        <Stat label="Ready to use" value={ready} hint="consent granted" icon="check" tone="brand" />
        <Stat label="Waiting on consent" value={all.filter((r) => r.p.consentStatus === "Asked").length} hint="asked, no answer yet" icon="hourglass" />
        <Stat label="Not asked yet" value={all.filter((r) => !r.p.consentStatus || r.p.consentStatus === "Not asked").length} icon="alert" />
      </div>

      <form action="/proof" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter the proof bank">
        <label className="field">
          Consent
          <select name="consent" defaultValue={sp.consent ?? ""} className="input input-sm">
            <option value="">All</option>
            {PROOF_CONSENT.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select name="type" defaultValue={sp.type ?? ""} className="input input-sm">
            <option value="">All</option>
            {PROOF_TYPES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Batch
          <select name="batch" defaultValue={sp.batch ?? ""} className="input input-sm">
            <option value="">All</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary btn-sm">Filter</button>
        {(sp.consent || sp.type || sp.batch) && (
          <Link href="/proof" className="btn btn-ghost btn-sm">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon="sparkle" title="Nothing here yet">
            Add proof from a student&rsquo;s page (Programme card), or in the Notion Proof &amp; Testimonial Bank.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ p, candidate, leadId, cohort, contentConsent }) => {
            const ok = publishable(p, contentConsent);
            return (
              <article key={p.id} className={`card flex flex-col gap-2 p-4 ${ok ? "border-ok/40" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium" dir="auto">
                    {p.name}
                  </h2>
                  <span className={`chip shrink-0 ${ok ? "chip-ok" : (CONSENT_CHIP[p.consentStatus ?? ""] ?? "")}`}>{ok ? "Ready" : (p.consentStatus ?? "Not asked")}</span>
                </div>
                <div className="text-xs text-muted">
                  {[p.type, cohort].filter(Boolean).join(" · ")}
                  {candidate && leadId && (
                    <>
                      {" · "}
                      <Link href={`/leads/${leadId}#programme`} className="hover:text-accent" dir="auto">
                        {candidate}
                      </Link>
                    </>
                  )}
                </div>
                {p.quote && (
                  <blockquote className="line-clamp-4 border-l-2 border-brand/50 pl-3 text-sm italic" dir="auto">
                    {p.quote}
                  </blockquote>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {p.usableIn.map((u) => (
                    <span key={u} className="chip">
                      {u}
                    </span>
                  ))}
                  {p.fileOrLink && (
                    <a href={p.fileOrLink} target="_blank" rel="noreferrer" className="ml-auto text-accent hover:underline">
                      Open file
                    </a>
                  )}
                </div>
                {p.consentStatus === "Granted" && contentConsent === false && (
                  <p className="text-xs text-warn">The item says Granted, but the candidate&rsquo;s consent is not on file: check before using.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
