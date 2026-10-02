import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { AVAILABILITY, listAlumni } from "@/lib/graduation";
import { TIER_LABEL } from "@/lib/pricing";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { saveAlumniAction } from "./actions";

export const metadata = { title: "Alumni" };

const CHIP = { open: "chip chip-ok", busy: "chip chip-warn", not_looking: "chip" } as const;

// Graduates and what they do well, for placement: who is free for paid work, with which skills.
export default async function AlumniPage(props: { searchParams: Promise<{ availability?: string; skill?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const availability = sp.availability && sp.availability in AVAILABILITY ? (sp.availability as keyof typeof AVAILABILITY) : undefined;
  const skill = sp.skill?.trim() || undefined;
  const [rows, all] = await Promise.all([listAlumni(db, { availability, skill }), listAlumni(db)]);
  const write = can(user.role, "programme:write");
  const back = `/alumni?${new URLSearchParams(Object.entries({ availability: availability ?? "", skill: skill ?? "" }).filter(([, v]) => v))}`;

  return (
    <>
      <PageHeader eyebrow="Programme" title="Alumni" subtitle="Graduates, their skills and whether they want paid work. Use it to place Freelance Ready and Production Partner graduates on real cases." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Graduates" value={all.length} icon="cohorts" tone="brand" />
        <Stat label="Open to paid work" value={all.filter((a) => a.availability === "open").length} icon="bolt" />
        <Stat label="Production Partner" value={all.filter((a) => a.tiers.includes("production_partner")).length} icon="sparkle" />
        <Stat label="With a portfolio" value={all.filter((a) => a.portfolioUrl).length} icon="layers" />
      </div>
      <form action="/alumni" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter alumni">
        <label className="field">
          Availability
          <select name="availability" defaultValue={availability ?? ""} className="input input-sm">
            <option value="">Any</option>
            {Object.entries(AVAILABILITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Skill
          <input name="skill" defaultValue={skill ?? ""} className="input input-sm" placeholder="e.g. crowns, implants" />
        </label>
        <button className="btn btn-secondary btn-sm">Filter</button>
        {(availability || skill) && (
          <Link href="/alumni" className="btn btn-ghost btn-sm">
            Clear
          </Link>
        )}
      </form>
      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="cohorts" title={all.length ? "Nobody matches." : "No graduates yet."}>
            {all.length ? "" : "Graduate students from a batch's Graduation page."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => (
              <li key={a.leadId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/leads/${a.leadId}`} className="link font-medium" dir="auto">
                    {a.fullName}
                  </Link>
                  <span className={CHIP[a.availability]}>{AVAILABILITY[a.availability]}</span>
                  {a.tiers.map((t) => (
                    <span key={t} className="chip">
                      {TIER_LABEL[t] ?? t}
                    </span>
                  ))}
                  {a.qc != null && <span className="num text-xs text-muted">QC {a.qc}</span>}
                </div>
                <div className="mt-1 text-xs text-muted" dir="auto">
                  {[a.headline, a.batches].filter(Boolean).join(" · ")}
                </div>
                {a.skills.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.skills.map((s) => (
                      <span key={s} className="chip chip-brand">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {a.portfolioUrl && (
                  <a href={a.portfolioUrl} target="_blank" rel="noreferrer" className="link mt-1 inline-block text-xs">
                    Portfolio
                  </a>
                )}
                {write && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted hover:text-fg">Edit profile</summary>
                    <form action={saveAlumniAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input type="hidden" name="leadId" value={a.leadId} />
                      <input type="hidden" name="back" value={back} />
                      <label className="field">
                        Headline
                        <input name="headline" maxLength={120} defaultValue={a.headline ?? ""} dir="auto" className="input input-sm" placeholder="Crown and bridge designer" />
                      </label>
                      <label className="field">
                        Availability
                        <select name="availability" defaultValue={a.availability} className="input input-sm">
                          {Object.entries(AVAILABILITY).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Skills (comma separated)
                        <input name="skills" defaultValue={a.skills.join(", ")} className="input input-sm" />
                      </label>
                      <label className="field">
                        Portfolio link
                        <input name="portfolioUrl" type="url" defaultValue={a.portfolioUrl ?? ""} dir="ltr" className="input input-sm" />
                      </label>
                      <label className="field sm:col-span-2">
                        Notes
                        <textarea name="notes" rows={2} defaultValue={a.notes ?? ""} dir="auto" className="input" />
                      </label>
                      <div className="sm:col-span-2">
                        <button className="btn btn-secondary btn-sm">Save profile</button>
                      </div>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
