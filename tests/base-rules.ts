import type postgres from "postgres";

/**
 * The base-plan suites test the original mechanics (stage moves, cadences, enrolment) on their own.
 * Release 1.1 adds exit criteria and workflow rules on top, tested in release-1-1.integration.test.ts;
 * here they are switched off so each suite keeps testing one thing.
 */
export async function withoutRelease11Rules(client: postgres.Sql) {
  await client.unsafe("delete from stage_exit_criteria; update workflow_rules set enabled = false;");
}
