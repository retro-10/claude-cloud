import Link from "next/link";
import { db } from "@/db";
import { listCohorts } from "@/lib/cohorts";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { AddEntry } from "@/components/finance/AddEntry";
import { FinanceNav } from "@/components/finance/FinanceNav";
import { Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { egp } from "@/lib/cohort-format";
import { SECTIONS, STATUS_LABEL, listCandidates, listEntries, type Section, type Status } from "@/lib/finance";
import { getSettings } from "@/lib/app-settings";
import { listTeam } from "@/lib/programme";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd, formatCairo } from "@/lib/time";
import { deleteEntryAction, settleEntryAction } from "../actions";

export const metadata = { title: "Ledger" };

const STATUS_CHIP: Record<Status, string> = { received: "chip-ok", paid: "chip-ok", expected: "chip-brand", owed: "chip-warn", cancelled: "" };

export default async function LedgerPage(props: {
  searchParams: Promise<{ month?: string; section?: string; status?: string; q?: string; candidate?: string; error?: string; notice?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await requirePageCan("finance:read");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month : undefined;
  const section = sp.section && sp.section in SECTIONS ? (sp.section as Section) : undefined;
  const status = sp.status && sp.status in STATUS_LABEL ? (sp.status as Status) : undefined;
  const enrolmentId = Number(sp.candidate) || undefined;
  const [rows, candidates, settings, team, batches] = await Promise.all([
    listEntries(db, { month, section, status, q: sp.q, enrolmentId }, 500),
    listCandidates(db),
    getSettings(db),
    listTeam(db),
    listCohorts(db),
  ]);
  const write = can(user.role, "payment:write");
  const qs = new URLSearchParams(
    Object.entries({ month, section, status, q: sp.q, candidate: sp.candidate }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const here = `/finance/ledger${qs ? `?${qs}` : ""}`;
  const opts = candidates.map((c) => ({ id: c.enrolmentId, name: `${c.fullName} · ${c.cohort}` }));
  const partners = settings.financeSplit.partners.map((p) => p.name);
  const signed = (r: (typeof rows)[number]) =>
    r.e.status === "cancelled" ? 0 : r.e.section === "income" ? (r.e.category === "Refund" ? -r.e.amountEgp : r.e.amountEgp) : -r.e.amountEgp;
  const total = rows.filter((r) => r.e.status === "received" || r.e.status === "paid").reduce((a, r) => a + signed(r), 0);
  const who = enrolmentId ? candidates.find((c) => c.enrolmentId === enrolmentId) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Ledger"
        subtitle="Every payment, cost and withdrawal. Expected and owed rows count only once they are received or paid."
        actions={
          write ? <AddEntry label="New entry" back={here} partners={partners} candidates={opts} team={team} batches={batches} variant="btn btn-primary" initial={who ? { section: "income", enrolmentId: who.enrolmentId } : undefined} /> : undefined
        }
      />
      <FinanceNav />
      <Flash error={sp.error} notice={sp.notice} />

      <form action="/finance/ledger" className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter the ledger">
        {sp.candidate && <input type="hidden" name="candidate" value={sp.candidate} />}
        <label className="field">
          Search
          <input name="q" defaultValue={sp.q} placeholder="Entry, from / to, notes" className="input input-sm w-56" dir="auto" />
        </label>
        <label className="field">
          Month
          <input name="month" type="month" defaultValue={month} className="input input-sm" />
        </label>
        <label className="field">
          Kind
          <select name="section" defaultValue={section ?? ""} className="input input-sm">
            <option value="">All</option>
            {(Object.keys(SECTIONS) as Section[]).map((s) => (
              <option key={s} value={s}>
                {SECTIONS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={status ?? ""} className="input input-sm">
            <option value="">All</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary btn-sm">
          <Icon name="filter" size={14} /> Filter
        </button>
        {qs && (
          <Link href="/finance/ledger" className="btn btn-ghost btn-sm">
            Clear
          </Link>
        )}
      </form>
      {who && (
        <p className="mb-3 text-sm text-muted">
          Showing entries for{" "}
          <Link href={`/leads/${who.leadId}#money`} className="font-medium text-fg hover:text-accent" dir="auto">
            {who.fullName}
          </Link>
          .
        </p>
      )}

      <Card bodyClass="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="list" title="No entries match">
            Try another month or clear the filters.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[980px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Kind · category</th>
                  <th>Status</th>
                  <th className="text-right">Amount</th>
                  {write && <th className="w-32 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = r.e;
                  const s = signed(r);
                  const open = e.status === "expected" || e.status === "owed";
                  return (
                    <tr key={e.id} className={e.status === "cancelled" ? "opacity-70" : ""}>
                      <td className="num whitespace-nowrap text-muted">
                        {e.date ? formatCairo(e.date, false) : <span title="No date: counted in the month it was added">{formatCairo(e.createdAt, false)}*</span>}
                        {e.dateApproximate && <span title="Approximate date"> ≈</span>}
                      </td>
                      <td>
                        <div className="font-medium" dir="auto">
                          {e.entry}
                        </div>
                        <div className="text-xs text-muted" dir="auto">
                          {[e.partner, r.teamMember, e.fromTo, r.cohort, e.reference && `ref ${e.reference}`].filter(Boolean).join(" · ")}
                          {r.candidate && r.leadId && (
                            <>
                              {" "}
                              <Link href={`/leads/${r.leadId}#money`} className="hover:text-accent">
                                {r.candidate}
                              </Link>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-muted">
                        {SECTIONS[e.section].label} · {e.category}
                      </td>
                      <td>
                        <span className={`chip ${STATUS_CHIP[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                      </td>
                      <td className={`num whitespace-nowrap text-right font-semibold ${e.status === "cancelled" ? "text-muted line-through" : s < 0 ? "" : "text-ok"}`}>
                        {s < 0 ? "−" : "+"}
                        {egp(e.amountEgp)}
                      </td>
                      {write && (
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {e.section === "income" && e.status === "received" && e.category !== "Refund" && (
                              <a href={`/receipts/${e.id}`} className="btn btn-ghost btn-icon btn-sm" title="Receipt" aria-label={`Receipt for ${e.entry}`}>
                                <Icon name="note" size={14} />
                              </a>
                            )}
                            {open && (
                              <form action={settleEntryAction}>
                                <input type="hidden" name="id" value={e.id} />
                                <input type="hidden" name="back" value={here} />
                                <button className="btn btn-ghost btn-icon btn-sm" title={e.section === "income" ? "Mark as received" : "Mark as paid"} aria-label={`Mark ${e.entry} as done`}>
                                  <Icon name="check" size={14} />
                                </button>
                              </form>
                            )}
                            <AddEntry
                              label={`Edit ${e.entry}`}
                              icon="edit"
                              variant="btn btn-ghost btn-icon btn-sm"
                              back={here}
                              partners={partners}
                              candidates={opts}
                              team={team}
                              batches={batches}
                              initial={{
                                id: e.id,
                                entry: e.entry,
                                amountEgp: e.amountEgp,
                                date: e.date ? cairoYmd(e.date) : undefined,
                                dateApproximate: e.dateApproximate,
                                section: e.section,
                                category: e.category,
                                status: e.status,
                                partner: e.partner,
                                fromTo: e.fromTo,
                                reference: e.reference,
                                notes: e.notes,
                                enrolmentId: e.enrolmentId,
                                teamMemberId: e.teamMemberId,
                                cohortId: e.enrolmentId ? null : e.cohortId,
                              }}
                            />
                            <form action={deleteEntryAction}>
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="back" value={here} />
                              <ConfirmButton
                                message={`Delete “${e.entry}”? It is removed from the books (and from Notion).`}
                                className="btn btn-ghost btn-icon btn-sm text-muted hover:text-danger"
                                aria-label={`Delete ${e.entry}`}
                                title="Delete"
                              >
                                <Icon name="trash" size={14} />
                              </ConfirmButton>
                            </form>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right text-xs text-muted">
                    Received − refunds − paid costs and withdrawals ({rows.length} rows{rows.length === 500 ? ", first 500" : ""})
                  </td>
                  <td className={`num text-right font-semibold ${total < 0 ? "text-danger" : ""}`}>{egp(total)}</td>
                  {write && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
