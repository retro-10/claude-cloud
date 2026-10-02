import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cohorts } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card, EmptyState, Icon, PageHeader, Stat } from "@/components/ui";
import { standings } from "@/lib/graduation";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { graduateAction, saveRulesAction } from "../../../alumni/actions";

export const metadata = { title: "Graduation · Batch" };

export default async function GraduationPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [[c], { rules, rows }] = await Promise.all([db.select().from(cohorts).where(eq(cohorts.id, id)), standings(db, id)]);
  if (!c) notFound();
  const write = can(user.role, "programme:write");
  const owner = can(user.role, "settings:write");

  return (
    <>
      <Link href={`/cohorts/${id}`} className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> {c.name}
      </Link>
      <PageHeader eyebrow={c.name} title="Graduation" subtitle="Who has met this batch's rules, what is missing for the others, and certificates for those who graduate." />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Students" value={rows.length} icon="leads" />
        <Stat label="Ready to graduate" value={rows.filter((r) => r.eligible && !r.certificate).length} icon="check" tone="brand" />
        <Stat label="Graduated" value={rows.filter((r) => r.certificate && !r.certificate.revoked).length} icon="cohorts" />
        <Stat label="Not yet" value={rows.filter((r) => !r.eligible && !r.certificate).length} icon="hourglass" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Students" icon="leads" bodyClass="p-0">
          {rows.length === 0 ? (
            <EmptyState icon="leads" title="No students in this batch." />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.enrolmentId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${r.leadId}`} className="link font-medium" dir="auto">
                      {r.fullName}
                    </Link>
                    {r.certificate && !r.certificate.revoked ? (
                      <a href={`/certificates/${r.certificate.code}`} className="chip chip-ok">
                        Graduated · {r.certificate.code}
                      </a>
                    ) : r.eligible ? (
                      <span className="chip chip-ok">Ready</span>
                    ) : (
                      <span className="chip chip-warn">Not yet</span>
                    )}
                    {r.certificate?.revoked && <span className="chip chip-danger">certificate revoked</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>Attendance {r.attendance == null ? "not taken" : `${Math.round(r.attendance * 100)}%`}</span>
                    <span>
                      Assignments {r.passed} of {r.assignments} passed
                    </span>
                  </div>
                  {r.missing.length > 0 && <p className="mt-1 text-xs text-warn">Missing: {r.missing.join("; ")}</p>}
                  {write && (!r.certificate || r.certificate.revoked) && (r.eligible || owner) && (
                    <form action={graduateAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
                      <input type="hidden" name="cohortId" value={id} />
                      {!r.eligible && (
                        <label className="field min-w-0 flex-1">
                          Reason to graduate anyway (owners)
                          <input name="override" required maxLength={300} className="input input-sm" />
                        </label>
                      )}
                      <button className={r.eligible ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}>Graduate and issue the certificate</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Rules for this batch" icon="target">
          {write ? (
            <form action={saveRulesAction} className="grid gap-3">
              <input type="hidden" name="cohortId" value={id} />
              <label className="field">
                Minimum attendance (%)
                <input name="gradMinAttendancePct" type="number" min={0} max={100} defaultValue={rules.gradMinAttendancePct} className="input input-sm num" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="gradRequireAllPassed" defaultChecked={rules.gradRequireAllPassed} /> Every assignment passed
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="gradRequirePaid" defaultChecked={rules.gradRequirePaid} /> Paid in full
              </label>
              <button className="btn btn-secondary btn-sm self-start">Save rules</button>
              <p className="text-xs text-muted">Excused classes do not count against attendance. A batch with no classes marked has no attendance rule to meet.</p>
            </form>
          ) : (
            <p className="text-sm">
              Attendance {rules.gradMinAttendancePct}%{rules.gradRequireAllPassed ? ", every assignment passed" : ""}
              {rules.gradRequirePaid ? ", paid in full" : ""}.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
