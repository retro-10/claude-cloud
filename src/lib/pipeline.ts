import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { getSettings } from "./app-settings";
import { startOfCairoDay } from "./time";

export const BOARD_CARD_LIMIT = 40; // per column (most recently active first); the count badge always shows the true total

export type BoardCard = {
  id: number;
  fullName: string;
  tierInterest: string;
  stage: string;
  daysInStage: number;
  nextFollowUp: Date | null;
  overdue: boolean;
  phone: string | null;
  doNotContact: boolean;
  owner: string | null;
  source: string | null;
  offerAmountEgp: number | null;
  decisionDueAt: Date | null;
  neglected: boolean; // P3: open, no activity for the neglect threshold
  stale: boolean; // P3: open, no stage change for the stale threshold
  noNextStep: boolean; // P6
  tags: string[];
};

export type Board = { cards: BoardCard[]; totals: Record<string, number>; values: Record<string, number> };

type Row = {
  id: number;
  full_name: string;
  tier_interest: string;
  stage: string;
  kind: string;
  stage_since: Date;
  last_stage_at: Date;
  last_activity_at: Date;
  next_follow_up: Date | null;
  phone_whatsapp: string | null;
  do_not_contact: boolean;
  owner: string | null;
  source: string | null;
  offer_amount_egp: number | null;
  decision_due_at: Date | null;
  tags: string[];
};

export async function getBoard(db: Db, now = new Date()): Promise<Board> {
  const settings = await getSettings(db);
  const rows = (await db.execute(sql`
    select * from (
      select l.id, l.full_name, l.tier_interest, l.stage, s.kind, l.phone_whatsapp, l.do_not_contact, l.offer_amount_egp,
        l.decision_due_at, l.tags, u.name as owner, src.label as source,
        coalesce((select max(e.at) from stage_events e where e.lead_id = l.id and e.to_stage = l.stage), l.created_at) as stage_since,
        coalesce((select max(e.at) from stage_events e where e.lead_id = l.id), l.created_at) as last_stage_at,
        coalesce((select max(a.at) from activities a where a.lead_id = l.id), l.created_at) as last_activity_at,
        (select min(fu.due_at) from follow_ups fu
           where fu.lead_id = l.id and fu.done_at is null and fu.cancelled_at is null) as next_follow_up,
        row_number() over (partition by l.stage order by l.updated_at desc, l.id desc) as rn
      from leads l join stages s on s.key = l.stage
        left join users u on u.id = l.owner_id left join sources src on src.id = l.source_id
      where l.deleted_at is null
    ) t where rn <= ${BOARD_CARD_LIMIT}
    order by stage, rn
  `)) as unknown as Row[];

  const totalRows = (await db.execute(
    sql`select stage, count(*)::int as n, coalesce(sum(offer_amount_egp), 0)::int as v from leads where deleted_at is null group by stage`,
  )) as unknown as { stage: string; n: number; v: number }[];

  const dayStart = startOfCairoDay(now).getTime();
  const ms = (d: Date | string) => new Date(d).getTime();
  return {
    cards: rows.map((r) => {
      const next = r.next_follow_up ? new Date(r.next_follow_up) : null;
      const open = r.kind === "open";
      return {
        id: r.id,
        fullName: r.full_name,
        tierInterest: r.tier_interest,
        stage: r.stage,
        daysInStage: Math.max(0, Math.floor((now.getTime() - ms(r.stage_since)) / 86_400_000)),
        nextFollowUp: next,
        // overdue = due before today (Cairo); a follow-up due earlier today is still "today"
        overdue: next !== null && next.getTime() < dayStart,
        phone: r.phone_whatsapp,
        doNotContact: r.do_not_contact,
        owner: r.owner,
        source: r.source,
        offerAmountEgp: r.offer_amount_egp,
        decisionDueAt: r.decision_due_at ? new Date(r.decision_due_at) : null,
        neglected: open && now.getTime() - ms(r.last_activity_at) > settings.neglectDays * 86_400_000,
        stale: open && now.getTime() - ms(r.last_stage_at) > settings.staleDays * 86_400_000,
        noNextStep: (open || r.kind === "nurture") && next === null,
        tags: r.tags ?? [],
      };
    }),
    totals: Object.fromEntries(totalRows.map((t) => [t.stage, t.n])),
    values: Object.fromEntries(totalRows.map((t) => [t.stage, t.v])),
  };
}
