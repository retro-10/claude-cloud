import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { LIST_PRICE_EGP } from "./pricing";
import { cairoYmd } from "./time";

export type PlannerBatch = { id: number; name: string; seatCap: number; enrolled: number; closeYmd: string | null };
export type PlannerDefaults = {
  leadToConsult: number;
  consultToEnrol: number;
  avgPriceEgp: number;
  sample: { leads: number; consulted: number; enrolled: number };
  fromData: boolean;
  batches: PlannerBatch[];
};

// Below this many leads the history says little: the planner starts from cautious placeholders instead.
const MIN_SAMPLE = 30;

/** The last 180 days as the planner's starting point: real conversion and real average price when there is enough data. */
export async function plannerDefaults(db: Db, now = new Date()): Promise<PlannerDefaults> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const [[r], batches] = await Promise.all([
    db.execute<{ leads: number; consulted: number; enrolled: number; avg_price: number | null }>(sql`
      with sel as (select id from leads where deleted_at is null and created_at >= ${since}::timestamptz),
      held as (select distinct c.lead_id from consults c join sel on sel.id = c.lead_id where c.held)
      select (select count(*) from sel)::int as leads,
             (select count(*) from held)::int as consulted,
             (select count(distinct e.lead_id) from enrolments e join held h on h.lead_id = e.lead_id)::int as enrolled,
             (select avg(greatest(amount_egp - discount_egp, 0)) from enrolments
               where payment_plan <> 'free_seat' and created_at >= ${since}::timestamptz)::float as avg_price`),
    db.execute<{ id: number; name: string; seat_cap: number; enrolled: number; close_at: string | null }>(sql`
      select c.id, c.name, c.seat_cap, count(e.id) filter (where e.status is distinct from 'dropped')::int as enrolled, c.enrolment_close_at as close_at
      from cohorts c left join enrolments e on e.cohort_id = c.id
      where c.status <> 'closed' group by c.id order by c.id desc`),
  ]);
  const leads = Number(r.leads), consulted = Number(r.consulted), enrolled = Number(r.enrolled);
  const fromData = leads >= MIN_SAMPLE && consulted > 0 && enrolled > 0;
  const listAvg = Math.round((LIST_PRICE_EGP.foundation + LIST_PRICE_EGP.freelance_ready) / 2);
  return {
    leadToConsult: fromData ? consulted / leads : 0.2,
    consultToEnrol: fromData ? enrolled / consulted : 0.4,
    avgPriceEgp: r.avg_price ? Math.round(Number(r.avg_price)) : listAvg,
    sample: { leads, consulted, enrolled },
    fromData,
    batches: batches.map((b) => ({ id: b.id, name: b.name, seatCap: Number(b.seat_cap), enrolled: Number(b.enrolled), closeYmd: b.close_at ? cairoYmd(new Date(b.close_at)) : null })),
  };
}
