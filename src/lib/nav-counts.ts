import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { startOfCairoDay, startOfNextCairoDay } from "./time";

export type NavCounts = { today: number; uncontacted: number; overdue: number };

// One round trip for the sidebar badges. "today" = things that need action today: uncontacted new
// leads, overdue follow-ups and follow-ups due today (the same definitions as the Today page).
export async function navCounts(db: Db, now = new Date()): Promise<NavCounts> {
  const dayStart = startOfCairoDay(now).toISOString();
  const dayEnd = startOfNextCairoDay(now).toISOString();
  const [r] = (await db.execute(sql`
    select
      (select count(*)::int from leads l join stages s on s.key = l.stage
        where l.deleted_at is null and l.first_contact_at is null and s.kind = 'open') as uncontacted,
      (select count(*)::int from follow_ups f join leads l on l.id = f.lead_id
        where f.done_at is null and f.cancelled_at is null and l.deleted_at is null and f.due_at < ${dayStart}::timestamptz) as overdue,
      (select count(*)::int from follow_ups f join leads l on l.id = f.lead_id
        where f.done_at is null and f.cancelled_at is null and l.deleted_at is null
          and f.due_at >= ${dayStart}::timestamptz and f.due_at < ${dayEnd}::timestamptz) as due_today`)) as unknown as {
    uncontacted: number;
    overdue: number;
    due_today: number;
  }[];
  return { today: r.uncontacted + r.overdue + r.due_today, uncontacted: r.uncontacted, overdue: r.overdue };
}
