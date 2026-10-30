import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { TwoFactorGate } from "@/components/employee/TwoFactorGate";
import { Card, PageHeader } from "@/components/ui";
import { ScrollX } from "@/components/ui/ScrollX";
import { egp } from "@/lib/cohort-format";
import { WORKER_TYPES, changeRequests, listEmployees } from "@/lib/employees";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { audit } from "@/lib/audit";

export const metadata = { title: "Employees" };

// Owners: everyone's record. Finance: pay terms only (no contact details, dates, manager or documents).
export default async function EmployeesPage() {
  const user = await requirePageCan("employee:self");
  const manage = can(user.role, "employee:manage");
  if (!manage && !can(user.role, "employee:pay")) notFound();
  if (!user.twoFactor) return <TwoFactorGate title="Employees" />;
  const [rows, pending] = await Promise.all([listEmployees(db, manage ? "full" : "pay"), manage ? changeRequests(db, { pending: true }) : Promise.resolve([])]);
  await audit(db, { userId: user.id, entity: "employee", entityId: 0, action: manage ? "list" : "list_pay" });

  return (
    <>
      <PageHeader
        eyebrow="Employee records"
        title={manage ? "Employees" : "Pay terms"}
        subtitle={manage ? "Everyone's record, terms and documents. Opening a record is logged." : "Each person's pay terms. Contact details, dates and documents are for the owners."}
      />
      {pending.length > 0 && (
        <div role="status" className="mb-5 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          {pending.length} change request{pending.length === 1 ? "" : "s"} waiting:{" "}
          {pending.map(({ r, name }, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={`/employees/${r.userId}`} className="font-medium underline">
                {name}
              </Link>
            </span>
          ))}
        </div>
      )}
      <Card bodyClass="p-0">
        <ScrollX label="Employees">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Worker type</th>
                {manage && <th scope="col">Job title</th>}
                {manage && <th scope="col">Started</th>}
                <th scope="col">Pay terms</th>
                <th scope="col" className="text-right">
                  Pay
                </th>
                <th scope="col">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                  <td>
                    {manage ? (
                      <Link href={`/employees/${r.id}`} className="link font-medium" dir="auto">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium" dir="auto">
                        {r.name}
                      </span>
                    )}
                    <div className="text-xs text-muted">
                      {r.role}
                      {!r.active && " · inactive"}
                    </div>
                  </td>
                  <td>{r.workerType ? WORKER_TYPES[r.workerType] : <span className="text-muted">No record</span>}</td>
                  {manage && "jobTitle" in r && <td dir="auto">{r.jobTitle ?? "—"}</td>}
                  {manage && "startDate" in r && <td className="num">{r.startDate ?? "—"}</td>}
                  <td dir="auto">{r.payTerms ?? "—"}</td>
                  <td className="num text-right">{r.payAmountEgp != null ? egp(r.payAmountEgp) : "—"}</td>
                  <td dir="auto">{r.paySchedule ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </Card>
    </>
  );
}
