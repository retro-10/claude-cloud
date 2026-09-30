import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cadenceTemplates, followUps, leads, lostReasons, notifications, users, workflowRules, workflowRuns, type RuleAction } from "@/db/schema";
import { applyCadence } from "./followups";
import { getSettings } from "./app-settings";
import { waitingMinutes } from "./speed";

/**
 * W1: simple workflow rules. A rule = trigger + optional conditions + actions. Rules create
 * follow-ups, tags, owners and in-app notifications. They NEVER send a message to a lead.
 * Every firing is written to workflow_runs so the owner can see what happened and when.
 */
export type Trigger = "lead_created" | "stage_changed" | "inbound_logged" | "consult_outcome" | "follow_up_overdue" | "sla_breached";

export const TRIGGERS: Record<Trigger, string> = {
  lead_created: "A lead is created",
  stage_changed: "A lead changes stage",
  inbound_logged: "The lead replies (incoming message logged)",
  consult_outcome: "A consult result is recorded",
  follow_up_overdue: "A follow-up is overdue",
  sla_breached: "A new lead waits past the red response time",
};

export type RuleEvent =
  | { trigger: "lead_created"; leadId: number }
  | { trigger: "stage_changed"; leadId: number; from: string; to: string; lostReasonId?: number | null }
  | { trigger: "inbound_logged"; leadId: number }
  | { trigger: "consult_outcome"; leadId: number; result: "held" | "no_show"; outcome?: string | null }
  | { trigger: "follow_up_overdue"; leadId: number; followUpId: number }
  | { trigger: "sla_breached"; leadId: number };

// Anything with select/insert/update/transaction: the app db or a transaction.
type Exec = Db;
type Rule = typeof workflowRules.$inferSelect;

/** Conditions are plain key → value pairs; every one present must match. */
async function conditionsMatch(db: Exec, rule: Rule, ev: RuleEvent, lead: typeof leads.$inferSelect): Promise<boolean> {
  const c = rule.conditions ?? {};
  if (c.to_stage && !(ev.trigger === "stage_changed" && ev.to === c.to_stage)) return false;
  if (c.result && !(ev.trigger === "consult_outcome" && ev.result === c.result)) return false;
  if (c.outcome && !(ev.trigger === "consult_outcome" && ev.outcome === c.outcome)) return false;
  if (c.segment && lead.segment !== c.segment) return false;
  if (c.source && String(lead.sourceId ?? "") !== c.source) return false;
  if (c.tier && lead.tierInterest !== c.tier) return false;
  if (c.unassigned === "1" && lead.ownerId !== null) return false;
  if (c.lost_reason) {
    if (ev.trigger !== "stage_changed" || !ev.lostReasonId) return false;
    const [r] = await db.select().from(lostReasons).where(eq(lostReasons.id, ev.lostReasonId));
    if (r?.label !== c.lost_reason) return false;
  }
  return true;
}

/** Who gets a notification about a lead: its owner, or every active owner-role user if unassigned. */
async function recipients(db: Exec, lead: typeof leads.$inferSelect): Promise<number[]> {
  if (lead.ownerId) return [lead.ownerId];
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true)));
  return rows.map((r) => r.id);
}

async function runAction(db: Exec, a: RuleAction, rule: Rule, ev: RuleEvent, lead: typeof leads.$inferSelect, userId: number | null, now: Date): Promise<string> {
  switch (a.type) {
    case "create_follow_up": {
      let due: Date;
      if (a.dueAt === "decision_date") {
        if (!lead.decisionDueAt) return "no decision date, follow-up skipped";
        due = lead.decisionDueAt;
      } else due = new Date(now.getTime() + (a.dueInMinutes ?? 0) * 60_000);
      await db.insert(followUps).values({ leadId: lead.id, dueAt: due, kind: a.kind, note: a.note, createdBy: userId, ruleId: rule.id });
      return `follow-up “${a.note}”`;
    }
    case "apply_cadence": {
      const [tpl] = await db.select().from(cadenceTemplates).where(eq(cadenceTemplates.name, a.cadence));
      if (!tpl) return `cadence “${a.cadence}” not found`;
      const r = await applyCadence(db, { leadId: lead.id, templateId: tpl.id, start: now }, userId);
      return r.ok ? `cadence “${a.cadence}” (${r.created} steps)` : `cadence “${a.cadence}” not applied (${r.error.replace("_", " ")})`;
    }
    case "cancel_follow_ups": {
      const rows = await db
        .update(followUps)
        .set({ cancelledAt: now })
        .where(and(eq(followUps.leadId, lead.id), isNull(followUps.doneAt), isNull(followUps.cancelledAt)))
        .returning({ id: followUps.id });
      return `cancelled ${rows.length} follow-up${rows.length === 1 ? "" : "s"}`;
    }
    case "add_tag": {
      if (a.ifLostReasons?.length) {
        if (ev.trigger !== "stage_changed" || !ev.lostReasonId) return "no lost reason, tag skipped";
        const [r] = await db.select().from(lostReasons).where(eq(lostReasons.id, ev.lostReasonId));
        if (!r || !a.ifLostReasons.includes(r.label)) return `reason “${r?.label}”, tag skipped`;
      }
      await db
        .update(leads)
        .set({ tags: sql`(select array(select distinct unnest(${leads.tags} || array[${a.tag}]::text[]) order by 1))` })
        .where(eq(leads.id, lead.id));
      return `tag “${a.tag}”`;
    }
    case "set_owner": {
      await db.update(leads).set({ ownerId: a.userId }).where(eq(leads.id, lead.id));
      return `owner set`;
    }
    case "notify": {
      const to = await recipients(db, lead);
      if (to.length) {
        const title = a.title.replace("{name}", lead.fullName);
        await db.insert(notifications).values(to.map((u) => ({ userId: u, kind: rule.key ?? "rule", title, leadId: lead.id })));
      }
      return `notified ${to.length}`;
    }
  }
}

/** Runs every enabled rule for this event. Call inside the same transaction as the change itself. */
export async function fireRules(db: Exec, ev: RuleEvent, userId: number | null, opts: { now?: Date; dedupeKey?: (rule: Rule) => string } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const rules = await db
    .select()
    .from(workflowRules)
    .where(and(eq(workflowRules.trigger, ev.trigger), eq(workflowRules.enabled, true)))
    .orderBy(asc(workflowRules.position), asc(workflowRules.id));
  if (!rules.length) return 0;
  const [lead] = await db.select().from(leads).where(eq(leads.id, ev.leadId));
  if (!lead || lead.deletedAt) return 0;

  let fired = 0;
  for (const rule of rules) {
    if (!(await conditionsMatch(db, rule, ev, lead))) continue;
    const dedupeKey = opts.dedupeKey?.(rule) ?? null;
    if (dedupeKey) {
      // claim the key first: a scheduled trigger fires once per thing, even with two sweeps racing
      const claimed = await db.insert(workflowRuns).values({ ruleId: rule.id, leadId: lead.id, result: "running", dedupeKey, firedAt: now }).onConflictDoNothing().returning({ id: workflowRuns.id });
      if (!claimed.length) continue;
      const done: string[] = [];
      for (const a of rule.actions) done.push(await runAction(db, a, rule, ev, lead, userId, now));
      await db.update(workflowRuns).set({ result: done.join("; ") }).where(eq(workflowRuns.id, claimed[0].id));
    } else {
      const done: string[] = [];
      for (const a of rule.actions) done.push(await runAction(db, a, rule, ev, lead, userId, now));
      await db.insert(workflowRuns).values({ ruleId: rule.id, leadId: lead.id, result: done.join("; "), firedAt: now });
    }
    fired++;
  }
  return fired;
}

/**
 * Time-based triggers (overdue follow-ups, response-time breaches). Idempotent: each rule fires at
 * most once per follow-up or lead (workflow_runs.dedupe_key), so running it often is harmless.
 * Runs every few minutes in the server process and on each Today page load.
 */
export async function runScheduledRules(db: Db, now = new Date()): Promise<number> {
  const rules = await db
    .select()
    .from(workflowRules)
    .where(and(eq(workflowRules.enabled, true), inArray(workflowRules.trigger, ["follow_up_overdue", "sla_breached"])));
  let fired = 0;

  for (const rule of rules.filter((r) => r.trigger === "follow_up_overdue")) {
    const hours = Number(rule.conditions?.overdue_hours ?? 24);
    const cutoff = new Date(now.getTime() - (Number.isFinite(hours) ? hours : 24) * 3600_000);
    const due = await db
      .select({ id: followUps.id, leadId: followUps.leadId })
      .from(followUps)
      .innerJoin(leads, eq(leads.id, followUps.leadId))
      .where(
        and(
          isNull(followUps.doneAt),
          isNull(followUps.cancelledAt),
          isNull(leads.deletedAt),
          lt(followUps.dueAt, cutoff),
          sql`not exists (select 1 from workflow_runs r where r.dedupe_key = ${`rule:${rule.id}:fu:`} || ${followUps.id}::text)`,
        ),
      )
      .limit(200);
    for (const f of due) {
      fired += await db.transaction((tx) =>
        fireRules(tx as unknown as Db, { trigger: "follow_up_overdue", leadId: f.leadId, followUpId: f.id }, null, {
          now,
          dedupeKey: (r) => `rule:${r.id}:fu:${f.id}`,
        }),
      );
    }
  }

  const slaRules = rules.filter((r) => r.trigger === "sla_breached");
  if (slaRules.length) {
    const s = await getSettings(db);
    // candidates: uncontacted open leads; the exact waiting time (working hours aware) is checked in JS
    const waiting = await db.execute(sql`
      select l.id, l.created_at from leads l join stages st on st.key = l.stage
      where l.deleted_at is null and l.first_contact_at is null and st.kind = 'open'
        and l.created_at < ${new Date(now.getTime() - s.slaRedMin * 60_000).toISOString()}::timestamptz
      order by l.created_at asc limit 200`);
    for (const row of waiting as unknown as { id: number; created_at: string }[]) {
      if (waitingMinutes(new Date(row.created_at), now, s.workingHours) < s.slaRedMin) continue;
      fired += await db.transaction((tx) =>
        fireRules(tx as unknown as Db, { trigger: "sla_breached", leadId: row.id }, null, { now, dedupeKey: (r) => `rule:${r.id}:sla:${row.id}` }),
      );
    }
  }
  return fired;
}
