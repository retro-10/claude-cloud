import Link from "next/link";
import { listCohorts } from "@/lib/cohorts";
import { db } from "@/db";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { closeLabel, egp } from "@/lib/cohort-format";
import { formatCairo } from "@/lib/time";
import { createCohortAction } from "./actions";
import { Flash } from "@/components/Flash";
import { EmptyState, PageHeader } from "@/components/ui";

const box = "input";

export default async function CohortsPage(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const list = await listCohorts(db);
  const now = new Date();
  return (
    <>
      <PageHeader eyebrow="Programme" title="Batches" subtitle="Seats are real QC capacity. Every deadline in the CRM and in templates comes from these records." />
      <Flash error={searchParams.error} />
      {list.length === 0 && (
        <div className="card">
          <EmptyState icon="cohorts" title="No batches yet" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((c, i) => {
          const pct = c.seatCap ? Math.min(100, Math.round((c.seatsUsed / c.seatCap) * 100)) : 0;
          const full = c.seatsUsed >= c.seatCap;
          const open = c.enrolmentCloseAt ? c.enrolmentCloseAt > now : true;
          return (
            <Link
              key={c.id}
              href={`/cohorts/${c.id}`}
              style={{ animationDelay: `${i * 40}ms` }}
              className={`card group relative flex flex-col gap-4 overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift animate-rise-in`}
            >
              {open && <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold group-hover:text-accent" dir="auto">
                    {c.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">Masterclass {formatCairo(c.masterclassAt, false) || "not set"}</p>
                </div>
                <span className={`chip ${open ? (full ? "chip-warn" : "chip-brand") : ""}`}>{closeLabel(c.enrolmentCloseAt)}</span>
              </div>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-muted">Seats</span>
                  <span className="num font-medium">
                    {c.seatsUsed} / {c.seatCap}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label={`${c.name} seats taken`} aria-valuenow={c.seatsUsed} aria-valuemin={0} aria-valuemax={c.seatCap}>
                  <div className={`h-full rounded-full ${full ? "bg-warn" : "bg-gradient-to-r from-brand-deep to-brand"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              {can(user.role, "finance:read") && (
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="text-xs text-muted">Revenue</span>
                  <span className="num font-display text-lg font-semibold">{egp(c.revenueEgp)}</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {can(user.role, "settings:write") && (
        <form action={createCohortAction} className="card mt-6 grid max-w-2xl grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <h2 className="font-display text-lg font-semibold sm:col-span-2">New batch</h2>
          <label className="field">
            Name
            <input name="name" required dir="auto" className={box} />
          </label>
          <label className="field">
            Seat cap (real QC capacity)
            <input name="seatCap" type="number" min={1} required className={box} />
          </label>
          <label className="field">
            Masterclass (Cairo time)
            <input name="masterclassAt" type="datetime-local" className={box} />
          </label>
          <label className="field">
            Enrolment closes (Cairo time)
            <input name="enrolmentCloseAt" type="datetime-local" className={box} />
          </label>
          <label className="field">
            Course starts
            <input name="startAt" type="datetime-local" className={box} />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary">Create batch</button>
          </div>
        </form>
      )}
    </>
  );
}
