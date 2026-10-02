import Link from "next/link";
import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { Card, EmptyState, Icon, PageHeader, Stat } from "@/components/ui";
import { CASE_STATUS, listCaseTypes, listCases, listClients, listDesigners, seesAllCases, seesMoney, type CaseListRow, type CaseStatus } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo, toCairoLocalInput } from "@/lib/time";
import { createCaseAction } from "./actions";

export const metadata = { title: "Production" };

const COLUMNS: CaseStatus[] = ["received", "assigned", "designing", "qc", "delivered"];
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

function CaseCard({ c, money }: { c: CaseListRow; money: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/production/cases/${c.id}`} className="link font-medium">
          {c.code}
        </Link>
        <span className="flex gap-1">
          {c.rush && <span className="chip chip-warn">rush</span>}
          {c.status === "qc" && c.qcPassedAt && <span className="chip chip-ok">passed</span>}
        </span>
      </div>
      <div className="mt-0.5 truncate" dir="auto">
        {c.client}
      </div>
      <div className="text-xs text-muted">
        {c.type} × {c.units}
        {c.designer ? ` · ${c.designer}` : ""}
        {money ? ` · ${egp(c.priceEgp)}` : ""}
      </div>
      <div className={`mt-1 text-xs ${c.late ? "font-medium text-danger" : "text-muted"}`}>
        {c.status === "delivered" ? `Delivered ${formatCairo(c.deliveredAt, false)}` : `Due ${formatCairo(c.dueAt)}`}
        {c.late && c.status !== "delivered" ? " · late" : ""}
      </div>
    </div>
  );
}

// The production board: every open case by stage, and what was delivered in the last 30 days and is not yet invoiced.
export default async function ProductionPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("production:read");
  const manage = can(user.role, "production:manage");
  const money = seesMoney(user);
  const all = seesAllCases(user);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, clients, types, designers] = await Promise.all([
    listCases(db, user, { status: COLUMNS, deliveredSince: since }),
    manage ? listClients(db, { activeOnly: true }) : Promise.resolve([]),
    manage ? listCaseTypes(db, { activeOnly: true }) : Promise.resolve([]),
    manage ? listDesigners(db) : Promise.resolve([]),
  ]);
  const open = rows.filter((r) => r.status !== "delivered");
  const late = open.filter((r) => r.late).length;
  const qc = rows.filter((r) => r.status === "qc" && !r.qcPassedAt).length;
  const toInvoice = rows.filter((r) => r.status === "delivered").length;

  return (
    <>
      <PageHeader
        eyebrow="Production studio"
        title={all ? "Cases" : "My cases"}
        subtitle={all ? "Design work from clinics and labs: received, assigned, designed, checked, delivered and invoiced." : "The cases assigned to you. Start one, add the design files, and send it to QC."}
      />
      <ProductionTabs role={user.role} current="/production" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open cases" value={open.length} icon="layers" />
        <Stat label="Late" value={late} icon="alert" hint={late ? "past their due time" : "none"} />
        <Stat label="Waiting for QC" value={qc} icon="check" />
        <Stat label={all ? "Delivered, to invoice" : "Delivered (30 days)"} value={toInvoice} icon="send" />
      </div>
      <div className={manage ? "grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]" : ""}>
        <div className="grid min-w-0 gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(5,minmax(210px,1fr))]" tabIndex={0} role="region" aria-label="Cases by stage">
          {COLUMNS.map((st) => {
            const col = rows.filter((r) => r.status === st);
            return (
              <section key={st} aria-label={CASE_STATUS[st]} className="card flex flex-col p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                  {CASE_STATUS[st]} <span className="count">{col.length}</span>
                </h2>
                {col.length === 0 && <EmptyState icon="layers" title="Empty" />}
                <ul className="flex flex-col gap-2">
                  {col.map((c) => (
                    <li key={c.id}>
                      <CaseCard c={c} money={money} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {manage && (
          <Card title="Take a case in" icon="plus" className="max-w-3xl 2xl:max-w-none">
            {!clients.length || !types.length ? (
              <p className="text-sm text-muted">
                First add {!clients.length ? <Link href="/production/clients" className="link">a client</Link> : null}
                {!clients.length && !types.length ? " and " : ""}
                {!types.length ? <Link href="/production/prices" className="link">the price list</Link> : null}.
              </p>
            ) : (
              <form action={createCaseAction} className="grid gap-3">
                <label className="field">
                  Client
                  <select name="clientId" required defaultValue="" className="input">
                    <option value="" disabled>
                      Choose
                    </option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.discountPct ? ` (−${c.discountPct}%)` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
                  <label className="field">
                    Case type
                    <select name="caseTypeId" required defaultValue="" className="input">
                      <option value="" disabled>
                        Choose
                      </option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Units
                    <input name="units" type="number" min={1} max={100} defaultValue={1} required className="input num" />
                  </label>
                </div>
                <label className="field">
                  Client&apos;s reference (no patient names)
                  <input name="reference" maxLength={120} className="input" placeholder="e.g. Dr Samir · job 4471" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="rush" /> Rush (quicker, with the surcharge)
                </label>
                <label className="field">
                  Designer
                  <select name="designerId" defaultValue="" className="input">
                    <option value="">Assign later</option>
                    {designers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="field">
                    Received
                    <input name="receivedAt" type="datetime-local" defaultValue={toCairoLocalInput(new Date())} className="input input-sm" />
                  </label>
                  <label className="field">
                    Due (empty = price list)
                    <input name="dueAt" type="datetime-local" className="input input-sm" />
                  </label>
                </div>
                <label className="field">
                  Notes
                  <textarea name="notes" rows={2} maxLength={4000} dir="auto" className="input" placeholder="Shade, material, the client's instructions" />
                </label>
                <button className="btn btn-primary btn-sm self-start justify-self-start">
                  <Icon name="plus" size={14} /> Take it in
                </button>
                <p className="text-xs text-muted">The price comes from the price list, the rush surcharge and the client&apos;s discount, and is fixed now.</p>
              </form>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
