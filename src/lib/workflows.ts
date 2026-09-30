import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cadenceTemplates, followUps, leads, lostReasons, notifications, users, workflowRules, workflowRuns, type RuleAction } from "@/db/schema";
import { audit } from "./audit";
import { applyCadence, cancelCadenceFollowUps } from "./followups";
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
    case "cancel_cadence": {
      const n = await cancelCadenceFollowUps(db, lead.id);
      return `stopped ${n} cadence step${n === 1 ? "" : "s"}`;
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
      await db.update(leads).set({ ownerId: a.userId, updatedAt: new Date() }).where(eq(leads.id, lead.id));
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
const SWEEP_BATCH = 50; // per rule per run: a backlog is worked off over a few runs, never in one long burst
let sweeping = false;

export async function runScheduledRules(db: Db, now = new Date()): Promise<number> {
  if (sweeping) return 0; // one sweep at a time per server process
  sweeping = true;
  try {
    return await sweep(db, now);
  } finally {
    sweeping = false;
  }
}

async function sweep(db: Db, now: Date): Promise<number> {
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
      .limit(SWEEP_BATCH);
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
      order by l.created_at asc limit ${SWEEP_BATCH}`);
    for (const row of waiting as unknown as { id: number; created_at: string }[]) {
      if (waitingMinutes(new Date(row.created_at), now, s.workingHours) < s.slaRedMin) continue;
      fired += await db.transaction((tx) =>
        fireRules(tx as unknown as Db, { trigger: "sla_breached", leadId: row.id }, null, { now, dedupeKey: (r) => `rule:${r.id}:sla:${row.id}` }),
      );
    }
  }
  return fired;
}

// ---- editing rules (Settings → Workflows) ----

const CONDITION_KEYS = ["to_stage", "result", "outcome", "segment", "source", "tier", "lost_reason", "overdue_hours", "unassigned"] as const;
export type RuleInput = { name: string; trigger: string; conditions: Record<string, string>; actions: RuleAction[] };

export function validateRule(r: RuleInput): string | null {
  if (!r.name.trim() || r.name.length > 120) return "Give the rule a name (up to 120 characters)";
  if (!(r.trigger in TRIGGERS)) return "Unknown trigger";
  for (const k of Object.keys(r.conditions)) if (!(CONDITION_KEYS as readonly string[]).includes(k)) return `Unknown condition ${k}`;
  if (r.conditions.overdue_hours && !/^\d{1,4}$/.test(r.conditions.overdue_hours)) return "Overdue hours must be a whole number";
  if (!r.actions.length) return "Add at least one action";
  for (const a of r.actions) {
    if (a.type === "create_follow_up" && (!a.note?.trim() || (a.dueInMinutes !== undefined && (!Number.isInteger(a.dueInMinutes) || a.dueInMinutes < 0 || a.dueInMinutes > 525_600))))
      return "A follow-up needs a note and a delay in minutes (0 or more)";
    if (a.type === "notify" && !a.title?.trim()) return "A notification needs a title";
    if (a.type === "add_tag" && !/^[a-z0-9-]{1,40}$/.test(a.tag)) return "Tags are lowercase letters, numbers and dashes";
    if (a.type === "apply_cadence" && !a.cadence?.trim()) return "Choose a cadence";
    if (a.type === "set_owner" && !Number.isInteger(a.userId)) return "Choose an owner";
  }
  return null;
}

export async function saveRule(db: Db, id: number | null, r: RuleInput, actorId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const bad = validateRule(r);
  if (bad) return { ok: false, error: bad };
  const conditions = Object.fromEntries(Object.entries(r.conditions).filter(([, v]) => v !== ""));
  if (id) {
    const [cur] = await db.select().from(workflowRules).where(eq(workflowRules.id, id));
    if (!cur) return { ok: false, error: "Rule not found" };
    // built-in rules keep their trigger; name, conditions and action details are editable
    await db.update(workflowRules).set({ name: r.name.trim(), conditions, actions: r.actions, trigger: cur.builtin ? cur.trigger : r.trigger }).where(eq(workflowRules.id, id));
  } else {
    await db.insert(workflowRules).values({ name: r.name.trim(), trigger: r.trigger, conditions, actions: r.actions, builtin: false, enabled: true, position: 100 });
  }
  await audit(db, { userId: actorId, entity: "workflow_rule", entityId: id ?? undefined, action: id ? "update" : "create" });
  return { ok: true };
}

export async function setRuleEnabled(db: Db, id: number, enabled: boolean, actorId: number | null) {
  await db.update(workflowRules).set({ enabled }).where(eq(workflowRules.id, id));
  await audit(db, { userId: actorId, entity: "workflow_rule", entityId: id, action: enabled ? "enable" : "disable" });
}

export async function deleteRule(db: Db, id: number, actorId: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const [r] = await db.select().from(workflowRules).where(eq(workflowRules.id, id));
  if (!r) return { ok: false, error: "Rule not found" };
  if (r.builtin) return { ok: false, error: "Built-in rules can be switched off but not deleted" };
  await db.delete(workflowRuns).where(eq(workflowRuns.ruleId, id));
  await db.update(followUps).set({ ruleId: null }).where(eq(followUps.ruleId, id));
  await db.delete(workflowRules).where(eq(workflowRules.id, id));
  await audit(db, { userId: actorId, entity: "workflow_rule", entityId: id, action: "delete" });
  return { ok: true };
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case "create_follow_up":
      return a.dueAt === "decision_date" ? `Follow-up on the decision date: “${a.note}”` : `Follow-up in ${a.dueInMinutes ?? 0} min: “${a.note}”`;
    case "apply_cadence":
      return `Start cadence “${a.cadence}”`;
    case "cancel_follow_ups":
      return "Cancel open follow-ups";
    case "cancel_cadence":
      return "Stop the running cadence";
    case "add_tag":
      return `Tag #${a.tag}${a.ifLostReasons?.length ? ` if the reason is ${a.ifLostReasons.join(" or ")}` : ""}`;
    case "set_owner":
      return "Assign an owner";
    case "notify":
      return `Notify: “${a.title}”`;
  }
}
