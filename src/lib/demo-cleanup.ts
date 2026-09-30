import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { audit } from "./audit";

// Demo rows are recognisable by construction (see src/db/demo-data.ts): leads named "Demo Lead 01".."Demo Lead 20"
// with numbers +20108000000xx, batches "Demo Cohort A/B" (and the empty placeholder "Demo cohort"), the
// "Masterclass Sep" demo campaign, and ledger / session / proof rows whose name starts with "DEMO ".
const DEMO_LEAD = sql`(full_name ~ '^Demo Lead [0-9]{2}$' and (phone_whatsapp like '+2010800000__' or phone_whatsapp is null))`;

export async function demoCounts(db: Db) {
  const [r] = await db.execute<{ leads: number; ledger: number }>(sql`
    select (select count(*) from leads where ${DEMO_LEAD})::int as leads,
           (select count(*) from ledger_entries where entry like 'DEMO %' and deleted_at is null)::int as ledger`);
  return { leads: Number(r.leads), ledger: Number(r.ledger) };
}

/** Deletes every demo row and everything hanging off it. Real leads, batches and money are never touched. */
export async function removeDemoData(db: Db, userId: number | null) {
  return db.transaction(async (tx) => {
    const run = (q: ReturnType<typeof sql>) => tx.execute(q);
    await run(sql`create temp table demo_leads on commit drop as select id from leads where ${DEMO_LEAD}`);
    await run(sql`create temp table demo_enrol on commit drop as select id from enrolments where lead_id in (select id from demo_leads)`);
    const [{ n: leadCount }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from demo_leads`);

    await run(sql`delete from ledger_entries where enrolment_id in (select id from demo_enrol) or entry like 'DEMO %'`);
    await run(sql`delete from programme_sessions where enrolment_id in (select id from demo_enrol) or name like 'DEMO %'`);
    await run(sql`delete from proof_items where enrolment_id in (select id from demo_enrol) or name like 'DEMO %'`);
    await run(sql`delete from notion_links where (entity = 'enrolment' and local_id in (select id from demo_enrol)) or (entity = 'lead' and local_id in (select id from demo_leads))`);
    await run(sql`delete from enrolments where id in (select id from demo_enrol)`);
    await run(sql`delete from consult_objections where consult_id in (select id from consults where lead_id in (select id from demo_leads))`);
    for (const t of ["consults", "activities", "follow_ups", "stage_events", "notifications", "workflow_runs", "consent_records"]) {
      await run(sql`delete from ${sql.raw(t)} where lead_id in (select id from demo_leads)`);
    }
    await run(sql`delete from lead_merges where loser_id in (select id from demo_leads) or survivor_id in (select id from demo_leads)`);
    await run(sql`delete from leads where id in (select id from demo_leads)`);
    // demo batches and campaign, only when nothing real uses them
    await run(sql`delete from notion_links where entity = 'cohort' and local_id in (select id from cohorts c where c.name in ('Demo Cohort A', 'Demo Cohort B', 'Demo cohort')
      and not exists (select 1 from enrolments e where e.cohort_id = c.id) and not exists (select 1 from ledger_entries x where x.cohort_id = c.id))`);
    await run(sql`delete from cohorts c where c.name in ('Demo Cohort A', 'Demo Cohort B', 'Demo cohort')
      and not exists (select 1 from enrolments e where e.cohort_id = c.id) and not exists (select 1 from ledger_entries x where x.cohort_id = c.id)`);
    await run(sql`delete from campaigns g where g.label = 'Masterclass Sep' and not exists (select 1 from leads l where l.campaign_id = g.id)`);
    await audit(tx, { userId, entity: "demo", action: "remove", diff: { leads: Number(leadCount) } });
    return { leads: Number(leadCount) };
  });
}
