import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { getSettings } from "./app-settings";
import { startOfCairoDay, startOfNextCairoDay } from "./time";
import { viewCounts, type ViewCounts } from "./views";

export type NavCounts = { today: number; overdue: number; views: ViewCounts };

// The sidebar badges. "today" = what needs action today, with the Today page's definitions:
// the response queue (people waiting on us), overdue follow-ups and follow-ups due today.
export async function navCounts(db: Db, now = new Date()): Promise<NavCounts> {
  const settings = await getSettings(db);
  const dayStart = startOfCairoDay(now).toISOString();
  const dayEnd = startOfNextCairoDay(now).toISOString();
  const [[r], views] = await Promise.all([
    db.execute(sql`
      select
        (select count(*)::int from leads l join stages s on s.key = l.stage
          where l.deleted_at is null and s.kind in ('open', 'nurture')
            and ((l.first_contact_at is null and s.kind = 'open')
              or exists (select 1 from follow_ups f where f.lead_id = l.id and f.kind = 'reply' and f.done_at is null and f.cancelled_at is null))) as queue,
        (select count(*)::int from follow_ups f join leads l on l.id = f.lead_id
          where f.done_at is null and f.cancelled_at is null and l.deleted_at is null and f.kind <> 'reply'
            and f.due_at < ${dayStart}::timestamptz) as overdue,
        (select count(*)::int from follow_ups f join leads l on l.id = f.lead_id
          where f.done_at is null and f.cancelled_at is null and l.deleted_at is null and f.kind <> 'reply'
            and f.due_at >= ${dayStart}::timestamptz and f.due_at < ${dayEnd}::timestamptz) as due_today`) as unknown as Promise<
      { queue: number; overdue: number; due_today: number }[]
    >,
    viewCounts(db, now, settings),
  ]);
  return { today: r.queue + r.overdue + r.due_today, overdue: r.overdue, views };
}
