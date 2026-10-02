import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cohorts, users } from "@/db/schema";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { ClassForm } from "@/components/programme/ClassForm";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { ATTENDANCE, getClass, roster } from "@/lib/classes";
import { listCohorts } from "@/lib/cohorts";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { deleteClassAction, markAttendanceAction } from "../actions";

export const metadata = { title: "Class" };

export default async function ClassPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [params, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requirePageCan("lead:read");
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const c = await getClass(db, id);
  if (!c) notFound();
  const [students, [cohort], batches, people] = await Promise.all([
    roster(db, id),
    db.select({ name: cohorts.name }).from(cohorts).where(eq(cohorts.id, c.cohortId)),
    listCohorts(db),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)),
  ]);
  const write = can(user.role, "programme:write");
  const instructor = people.find((p) => p.id === c.instructorId)?.name;

  return (
    <>
      <Link href={`/classes?batch=${c.cohortId}`} className="mb-3 flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <Icon name="chevronLeft" size={14} /> {cohort?.name} classes
      </Link>
      <PageHeader
        eyebrow={[cohort?.name, c.module].filter(Boolean).join(" · ")}
        title={c.title}
        titleDir="auto"
        subtitle={`${formatCairo(c.startsAt)} · ${c.durationMin} minutes${instructor ? ` · ${instructor}` : ""}${c.location ? ` · ${c.location}` : ""}`}
        actions={
          <span className="flex gap-2">
            {c.materialsUrl && (
              <a href={c.materialsUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                Materials
              </a>
            )}
            {c.recordingUrl && (
              <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                Recording
              </a>
            )}
          </span>
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title={`Attendance (${students.length} students)`} icon="check">
          {students.length === 0 ? (
            <EmptyState icon="leads" title="No students in this batch yet." />
          ) : (
            <form action={markAttendanceAction}>
              <input type="hidden" name="classId" value={c.id} />
              <ul className="divide-y divide-line">
                {students.map((s) => (
                  <li key={s.enrolmentId} className="flex flex-wrap items-center gap-3 py-2">
                    <Link href={`/leads/${s.leadId}`} className="link min-w-0 flex-1" dir="auto">
                      {s.fullName}
                    </Link>
                    {write ? (
                      <fieldset className="flex flex-wrap gap-3 text-sm">
                        <legend className="sr-only">{s.fullName}</legend>
                        {(Object.keys(ATTENDANCE) as (keyof typeof ATTENDANCE)[]).map((k) => (
                          <label key={k} className="flex items-center gap-1.5">
                            <input type="radio" name={`st-${s.enrolmentId}`} value={k} defaultChecked={s.status === k} /> {ATTENDANCE[k]}
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <span className="text-sm">{s.status ? ATTENDANCE[s.status] : "—"}</span>
                    )}
                  </li>
                ))}
              </ul>
              {write && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button className="btn btn-primary btn-sm">Save attendance</button>
                  <span className="text-xs text-muted">Two unexcused absences in a batch make a check-in task for you.</span>
                </div>
              )}
            </form>
          )}
        </Card>
        {write && (
          <div className="flex flex-col gap-5">
            <Card title="Edit class" icon="edit">
              <ClassForm c={c} batches={batches} people={people} back={`/classes/${c.id}`} />
            </Card>
            <form action={deleteClassAction}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton message="Remove this class from the schedule? Its attendance stays in the history." className="btn btn-ghost btn-sm">
                <Icon name="trash" size={14} /> Remove class
              </ConfirmButton>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
