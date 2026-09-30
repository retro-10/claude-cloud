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

/**
 * Deletes every demo row and everything hanging off it. Real leads, batches and money are never touched.
 * Rows already mirrored to Notion keep their link, marked "gone", so a later read of Notion never brings them
 * back as new rows; their pages are returned so the caller can archive them in Notion.
 */
export async function removeDemoData(db: Db, userId: number | null) {
  return db.transaction(async (tx) => {
    const run = (q: ReturnType<typeof sql>) => tx.execute(q);
    const DEMO_COHORT = sql`c.name in ('Demo Cohort A', 'Demo Cohort B', 'Demo cohort')
      and not exists (select 1 from enrolments e where e.cohort_id = c.id and e.lead_id not in (select id from demo_leads))
      and not exists (select 1 from ledger_entries x where x.cohort_id = c.id and x.id not in (select id from demo_ledger))`;
    await run(sql`create temp table demo_leads on commit drop as select id from leads where ${DEMO_LEAD}`);
    await run(sql`create temp table demo_enrol on commit drop as select id from enrolments where lead_id in (select id from demo_leads)`);
    await run(sql`create temp table demo_ledger on commit drop as select id from ledger_entries where enrolment_id in (select id from demo_enrol) or entry like 'DEMO %'`);
    await run(sql`create temp table demo_sessions on commit drop as select id from programme_sessions where enrolment_id in (select id from demo_enrol) or name like 'DEMO %'`);
    await run(sql`create temp table demo_proof on commit drop as select id from proof_items where enrolment_id in (select id from demo_enrol) or name like 'DEMO %'`);
    await run(sql`create temp table demo_cohorts on commit drop as select id from cohorts c where ${DEMO_COHORT}`);
    const [{ n: leadCount }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from demo_leads`);

    const pages = await tx.execute<{ page_id: string }>(sql`
      update notion_links set hash = 'gone' where hash is distinct from 'gone' and (
        (entity = 'lead' and local_id in (select id from demo_leads)) or (entity = 'enrolment' and local_id in (select id from demo_enrol))
        or (entity = 'ledger' and local_id in (select id from demo_ledger)) or (entity = 'session' and local_id in (select id from demo_sessions))
        or (entity = 'proof' and local_id in (select id from demo_proof)) or (entity = 'cohort' and local_id in (select id from demo_cohorts)))
      returning page_id`);

    await run(sql`delete from ledger_entries where id in (select id from demo_ledger)`);
    await run(sql`delete from programme_sessions where id in (select id from demo_sessions)`);
    await run(sql`delete from proof_items where id in (select id from demo_proof)`);
    await run(sql`delete from enrolments where id in (select id from demo_enrol)`);
    await run(sql`delete from consult_objections where consult_id in (select id from consults where lead_id in (select id from demo_leads))`);
    for (const t of ["consults", "activities", "follow_ups", "stage_events", "notifications", "workflow_runs", "consent_records", "tasks"]) {
      await run(sql`delete from ${sql.raw(t)} where lead_id in (select id from demo_leads)`);
    }
    await run(sql`delete from lead_merges where loser_id in (select id from demo_leads) or survivor_id in (select id from demo_leads)`);
    await run(sql`delete from leads where id in (select id from demo_leads)`);
    // demo batches and campaign, only when nothing real uses them
    await run(sql`update tasks set cohort_id = null where cohort_id in (select id from demo_cohorts)`);
    await run(sql`delete from cohorts where id in (select id from demo_cohorts)`);
    await run(sql`delete from campaigns g where g.label = 'Masterclass Sep' and not exists (select 1 from leads l where l.campaign_id = g.id)`);
    await audit(tx, { userId, entity: "demo", action: "remove", diff: { leads: Number(leadCount), notionPages: pages.length } });
    return { leads: Number(leadCount), notionPages: [...pages].map((p) => p.page_id) };
  });
}
