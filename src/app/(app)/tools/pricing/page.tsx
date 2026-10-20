import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PricingTool } from "@/components/tools/PricingTool";
import { PageHeader } from "@/components/ui";
import { listCohorts } from "@/lib/cohorts";
import { LIST_PRICE_EGP } from "@/lib/pricing";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Pricing scenarios · Tools" };

// Starts from a batch's real numbers (its students, discounts, free seats and tagged costs), or the Foundation price.
export default async function PricingPage(props: { searchParams: Promise<{ batch?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("finance:read");
  const batches = await listCohorts(db);
  const batch = batches.find((b) => b.id === Number(sp.batch)) ?? null;
  let start = { listPriceEgp: LIST_PRICE_EGP.foundation, discountPct: 0, seatCap: 40, fillPct: 75, freeSeats: 0, fixedCostsEgp: 0, variablePerStudentEgp: 0 };
  if (batch) {
    const [r] = await db.execute<{ students: number; free: number; list: number | null; discount: number | null; costs: number }>(sql`
      select count(*) filter (where e.status <> 'dropped')::int as students,
        count(*) filter (where e.status <> 'dropped' and e.payment_plan = 'free_seat')::int as free,
        round(avg(e.amount_egp) filter (where e.payment_plan <> 'free_seat'))::int as list,
        round(100.0 * sum(e.discount_egp) filter (where e.payment_plan <> 'free_seat') / nullif(sum(e.amount_egp) filter (where e.payment_plan <> 'free_seat'), 0))::int as discount,
        (select coalesce(sum(amount_egp), 0) from ledger_entries where deleted_at is null and cohort_id = ${batch.id} and section in ('fixed_costs', 'variable_costs') and status in ('paid', 'owed'))::int as costs
      from enrolments e where e.cohort_id = ${batch.id}`);
    start = {
      listPriceEgp: r.list ?? LIST_PRICE_EGP.foundation,
      discountPct: r.discount ?? 0,
      seatCap: batch.seatCap,
      fillPct: batch.seatCap ? Math.min(100, Math.round((Number(r.students) / batch.seatCap) * 100)) : 0,
      freeSeats: Number(r.free),
      fixedCostsEgp: Number(r.costs),
      variablePerStudentEgp: 0,
    };
  }
  return (
    <>
      <PageHeader
        eyebrow="Tools"
        title="Pricing scenarios"
        subtitle="What a price, discount, seat cap or cost change does to a batch's revenue and margin, and how many paying students cover the costs. Change the right-hand side and compare."
        actions={
          <form action="/tools/pricing" className="flex items-end gap-2">
            <label className="field">
              Start from a batch
              <select name="batch" defaultValue={batch?.id ?? ""} className="input input-sm">
                <option value="">Foundation list price</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-ghost btn-sm">Load</button>
          </form>
        }
      />
      <PricingTool key={batch?.id ?? 0} start={start} />
    </>
  );
}
