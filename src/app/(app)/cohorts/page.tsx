import Link from "next/link";
import { listCohorts } from "@/lib/cohorts";
import { db } from "@/db";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/server-auth";
import { closeLabel, egp } from "@/lib/cohort-format";
import { formatCairo } from "@/lib/time";
import { createCohortAction } from "./actions";

const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";

export default async function CohortsPage(props: { searchParams: Promise<{ error?: string }> }) {
  const searchParams = await props.searchParams;
  const user = await requireUser();
  const list = await listCohorts(db);
  return (
    <>
      <h1 className="mb-3 font-display text-2xl">Cohorts</h1>
      {searchParams.error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {searchParams.error}
        </p>
      )}
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Cohort</th>
              <th className="px-3 py-2">Masterclass</th>
              <th className="px-3 py-2">Enrolment</th>
              <th className="px-3 py-2">Seats</th>
              <th className="px-3 py-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-surface/60">
                <td className="px-3 py-2">
                  <Link href={`/cohorts/${c.id}`} className="font-medium hover:text-accent" dir="auto">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{formatCairo(c.masterclassAt, false) || "—"}</td>
                <td className="px-3 py-2">{closeLabel(c.enrolmentCloseAt)}</td>
                <td className={`px-3 py-2 ${c.seatsUsed >= c.seatCap ? "text-warn" : ""}`}>
                  {c.seatsUsed}/{c.seatCap}
                </td>
                <td className="px-3 py-2">{egp(c.revenueEgp)}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  No cohorts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {can(user.role, "settings:write") && (
        <form action={createCohortAction} className="mt-6 grid max-w-2xl grid-cols-1 gap-3 rounded border border-line bg-surface p-3 sm:grid-cols-2">
          <h2 className="font-display text-lg sm:col-span-2">New cohort</h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Name
            <input name="name" required dir="auto" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Seat cap (real QC capacity)
            <input name="seatCap" type="number" min={1} required className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Masterclass (Cairo time)
            <input name="masterclassAt" type="datetime-local" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Enrolment closes (Cairo time)
            <input name="enrolmentCloseAt" type="datetime-local" className={box} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Course starts
            <input name="startAt" type="datetime-local" className={box} />
          </label>
          <div className="flex items-end">
            <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Create cohort</button>
          </div>
        </form>
      )}
    </>
  );
}
