import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DEFAULT_QC, listCaseTypes } from "@/lib/production";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { saveCaseTypeAction } from "../actions";

export const metadata = { title: "Price list · Production" };
const egp = (n: number) => `${n.toLocaleString("en-US")} EGP`;

type Type = Awaited<ReturnType<typeof listCaseTypes>>[number];

function TypeForm({ t }: { t?: Type }) {
  return (
    <form action={saveCaseTypeAction} className="grid items-end gap-3 sm:grid-cols-3">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className="field sm:col-span-3">
        Case type
        <input name="name" required maxLength={80} defaultValue={t?.name} dir="auto" className="input input-sm" placeholder="Crown (per unit)" />
      </label>
      <label className="field">
        Price per unit (EGP)
        <input name="unitPriceEgp" type="number" min={1} required defaultValue={t?.unitPriceEgp} className="input input-sm num" />
      </label>
      <label className="field">
        Designer pay per unit
        <input name="designerPayEgp" type="number" min={0} required defaultValue={t?.designerPayEgp ?? 0} className="input input-sm num" />
      </label>
      <label className="field">
        Rush surcharge (%)
        <input name="rushSurchargePct" type="number" min={0} max={300} required defaultValue={t?.rushSurchargePct ?? 50} className="input input-sm num" />
      </label>
      <label className="field">
        Standard (working days)
        <input name="standardDays" type="number" min={0} max={60} required defaultValue={t?.standardDays ?? 2} className="input input-sm num" />
      </label>
      <label className="field">
        Rush (working days)
        <input name="rushDays" type="number" min={0} max={60} required defaultValue={t?.rushDays ?? 1} className="input input-sm num" />
      </label>
      {t && (
        <label className="flex items-center gap-2 self-end pb-1 text-sm">
          <input type="checkbox" name="active" defaultChecked={t.active} /> In use
        </label>
      )}
      <label className="field sm:col-span-3">
        QC checklist, one item per line (empty = the standard four)
        <textarea name="qcChecklist" rows={4} maxLength={4000} defaultValue={t?.qcChecklist.join("\n") ?? ""} dir="auto" className="input" placeholder={DEFAULT_QC.join("\n")} />
      </label>
      <button className="btn btn-primary btn-sm self-start justify-self-start">{t ? "Save" : "Add to the price list"}</button>
    </form>
  );
}

// What each kind of case costs the client, pays the designer, takes, and is checked against.
export default async function PricesPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("production:read");
  const manage = can(user.role, "production:manage");
  if (!manage && !can(user.role, "finance:read")) return <EmptyState icon="list" title="The price list is for owners and finance." />;
  const types = await listCaseTypes(db);
  return (
    <>
      <PageHeader
        eyebrow="Production studio"
        title="Price list"
        subtitle="Prices per unit, designer pay, turnaround in working days (Saturday to Thursday) and the QC checklist for each kind of case. A case keeps the price it was taken in at."
      />
      <ProductionTabs role={user.role} current="/production/prices" />
      <Flash notice={sp.notice} error={sp.error} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card title={`Case types (${types.length})`} icon="list" bodyClass="p-0">
          {!types.length ? (
            <EmptyState icon="list" title="No prices yet." />
          ) : (
            <ul className="divide-y divide-line">
              {types.map((t) => (
                <li key={t.id} className={`px-4 py-3 ${t.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-medium" dir="auto">
                      {t.name}
                    </span>
                    <span className="num text-sm">{egp(t.unitPriceEgp)}</span>
                    <span className="text-xs text-muted">
                      designer {egp(t.designerPayEgp)} · margin {Math.round(((t.unitPriceEgp - t.designerPayEgp) / t.unitPriceEgp) * 100)}% · {t.standardDays} days, rush {t.rushDays} (+{t.rushSurchargePct}%)
                      {t.active ? "" : " · not in use"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">QC: {(t.qcChecklist.length ? t.qcChecklist : DEFAULT_QC).join(" · ")}</div>
                  {manage && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-muted">Edit {t.name}</summary>
                      <div className="mt-2">
                        <TypeForm t={t} />
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manage && (
          <Card title="Add a case type" icon="plus">
            <TypeForm />
          </Card>
        )}
      </div>
    </>
  );
}
