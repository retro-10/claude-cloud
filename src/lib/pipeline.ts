import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export const BOARD_CARD_LIMIT = 100; // per column; the count badge always shows the true total

export type BoardCard = {
  id: number;
  fullName: string;
  tierInterest: string;
  stage: string;
  daysInStage: number;
  nextFollowUp: Date | null;
  overdue: boolean;
};

export type Board = { cards: BoardCard[]; totals: Record<string, number> };

type Row = {
  id: number;
  full_name: string;
  tier_interest: string;
  stage: string;
  stage_since: Date;
  next_follow_up: Date | null;
};

export async function getBoard(db: Db, now = new Date()): Promise<Board> {
  const nowIso = now.toISOString();
  const rows = (await db.execute(sql`
    select id, full_name, tier_interest, stage, stage_since, next_follow_up from (
      select l.id, l.full_name, l.tier_interest, l.stage,
        coalesce((select max(e.at) from stage_events e where e.lead_id = l.id and e.to_stage = l.stage), l.created_at) as stage_since,
        (select min(fu.due_at) from follow_ups fu
           where fu.lead_id = l.id and fu.done_at is null and fu.cancelled_at is null) as next_follow_up,
        row_number() over (partition by l.stage order by l.updated_at desc, l.id desc) as rn
      from leads l where l.deleted_at is null
    ) t where rn <= ${BOARD_CARD_LIMIT}
    order by stage, rn
  `)) as unknown as Row[];

  const totalRows = (await db.execute(
    sql`select stage, count(*)::int as n from leads where deleted_at is null group by stage`,
  )) as unknown as { stage: string; n: number }[];

  const at = new Date(nowIso);
  return {
    cards: rows.map((r) => {
      const since = new Date(r.stage_since);
      const next = r.next_follow_up ? new Date(r.next_follow_up) : null;
      return {
        id: r.id,
        fullName: r.full_name,
        tierInterest: r.tier_interest,
        stage: r.stage,
        daysInStage: Math.max(0, Math.floor((at.getTime() - since.getTime()) / 86_400_000)),
        nextFollowUp: next,
        overdue: next !== null && next.getTime() < at.getTime(),
      };
    }),
    totals: Object.fromEntries(totalRows.map((t) => [t.stage, t.n])),
  };
}
