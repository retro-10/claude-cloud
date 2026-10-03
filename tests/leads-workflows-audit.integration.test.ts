import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { createLead, logActivity, setDeleted, updateLead } from "@/lib/leads";
import { listLeads } from "@/lib/lead-list";
import { createUser } from "@/lib/settings";
import { fireRules, parseRuleJson, ruleStats, runScheduledRules, saveRule } from "@/lib/workflows";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Problems found in the leads and workflows audit, each pinned so it cannot come back.
d("leads and workflows audit", () => {
  const client = postgres(url ?? "postgres://x", { max: 6, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let me: number, sara: number, gone: number;
  let seq = 0;
  const mk = async (extra: Partial<Parameters<typeof createLead>[1]> = {}, userId: number | null = me) => {
    const r = await createLead(db, { fullName: `Audit Lead ${++seq}`, phone: `0102${String(seq).padStart(7, "0")}`, ...extra }, userId, { allowNameMatch: true });
    if (!r.ok) throw new Error(`setup: ${r.error}`);
    return r.lead;
  };
  const openFus = (leadId: number) => db.select().from(s.followUps).where(and(eq(s.followUps.leadId, leadId), isNull(s.followUps.doneAt), isNull(s.followUps.cancelledAt)));
  const ruleId = async (key: string) => (await db.select().from(s.workflowRules).where(eq(s.workflowRules.key, key)))[0].id;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    me = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
    const a = await createUser(db, { name: "Sara Sales", email: "sara@audit.local", role: "sales", password: "a-long-password-1" }, me);
    const b = await createUser(db, { name: "Gone Person", email: "gone@audit.local", role: "sales", password: "a-long-password-1" }, me);
    if (!a.ok || !b.ok) throw new Error("users");
    sara = a.id;
    gone = b.id;
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, gone));
  });
  beforeEach(async () => {
    await client`update workflow_rules set enabled = true where builtin`;
    await client`delete from workflow_runs where rule_id in (select id from workflow_rules where not builtin)`;
    await client`update follow_ups set rule_id = null where rule_id in (select id from workflow_rules where not builtin)`;
    await client`delete from workflow_rules where not builtin`;
  });
  afterAll(() => client.end());

  it("the response-time alert reaches every waiting lead, not only the oldest 50, and skips do-not-contact leads", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    const ids: number[] = [];
    for (let i = 0; i < 55; i++) ids.push((await mk({ ownerId: null })).id);
    const dnc = (await mk({ ownerId: null })).id;
    await db.update(s.leads).set({ createdAt: old }).where(inArray(s.leads.id, [...ids, dnc]));
    await db.update(s.leads).set({ doNotContact: true }).where(eq(s.leads.id, dnc));
    const sla = await ruleId("unassigned_escalation");
    await runScheduledRules(db);
    await runScheduledRules(db);
    const runs = await db.select().from(s.workflowRuns).where(eq(s.workflowRuns.ruleId, sla));
    const reached = new Set(runs.map((r) => r.leadId));
    expect(ids.filter((id) => !reached.has(id))).toEqual([]);
    expect(reached.has(dnc)).toBe(false);
  });

  it("several messages from a lead leave one 'reply' follow-up, not one per message", async () => {
    const l = await mk();
    for (let i = 0; i < 3; i++) await logActivity(db, { leadId: l.id, type: "whatsapp", direction: "in", body: `msg ${i}` }, me);
    const replies = (await openFus(l.id)).filter((f) => f.kind === "reply");
    expect(replies).toHaveLength(1);
  });

  it("a rule that assigns an owner then notifies tells the new owner", async () => {
    await saveRule(db, null, { name: "Route and tell", trigger: "lead_created", conditions: {}, actions: [{ type: "set_owner", userId: sara }, { type: "notify", title: "Yours: {name} ({name})" }] }, me);
    const l = await mk({ ownerId: null });
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.leadId, l.id), like(s.notifications.title, "Yours:%")));
    expect(notes.map((n) => n.userId)).toEqual([sara]);
    expect(notes[0].title).toBe(`Yours: ${l.fullName} (${l.fullName})`);
  });

  it("rules cannot assign to a deactivated person, use a cadence that does not exist, or set a condition their trigger never has", async () => {
    expect(await saveRule(db, null, { name: "x", trigger: "lead_created", conditions: {}, actions: [{ type: "set_owner", userId: gone }] }, me)).toMatchObject({ ok: false });
    expect(await saveRule(db, null, { name: "x", trigger: "lead_created", conditions: {}, actions: [{ type: "apply_cadence", cadence: "No such cadence" }] }, me)).toMatchObject({ ok: false });
    expect(await saveRule(db, null, { name: "x", trigger: "lead_created", conditions: { to_stage: "lost" }, actions: [{ type: "notify", title: "t" }] }, me)).toMatchObject({ ok: false });
    expect(await saveRule(db, null, { name: "x", trigger: "inbound_logged", conditions: { result: "held" }, actions: [{ type: "notify", title: "t" }] }, me)).toMatchObject({ ok: false });
  });

  it("an owner who has since been deactivated never receives new leads", async () => {
    await saveSettings(db, { defaultOwnerId: gone }, me);
    const l = await mk({}, sara);
    expect(l.ownerId).toBe(sara);
    await saveSettings(db, { defaultOwnerId: me }, me);
  });

  it("a broken rule action is logged and does not stop the lead being saved", async () => {
    await db.insert(s.workflowRules).values({ name: "Broken", trigger: "lead_created", conditions: {}, actions: [{ type: "add_tag", tag: "kept-out" }, { type: "create_follow_up", kind: "whatsapp", note: "x", dueInMinutes: 1e20 }], builtin: false, enabled: true, position: 100 });
    const l = await mk();
    expect(l.id).toBeGreaterThan(0);
    const [run] = await db.select({ result: s.workflowRuns.result }).from(s.workflowRuns).innerJoin(s.workflowRules, eq(s.workflowRules.id, s.workflowRuns.ruleId)).where(and(eq(s.workflowRules.name, "Broken"), eq(s.workflowRuns.leadId, l.id)));
    expect(run.result).toMatch(/failed/i);
    // the rule's earlier action is undone with it: no half-applied rule
    const [row] = await db.select().from(s.leads).where(eq(s.leads.id, l.id));
    expect(row.tags).not.toContain("kept-out");
  });

  it("deleting a lead cancels its open follow-ups", async () => {
    const l = await mk();
    expect((await openFus(l.id)).length).toBeGreaterThan(0);
    await setDeleted(db, l.id, true, me);
    expect(await openFus(l.id)).toEqual([]);
  });

  it("reassigning a lead tells the new owner; a deactivated person cannot be given a lead", async () => {
    const l = await mk({ ownerId: me });
    expect(await updateLead(db, l.id, { ownerId: gone }, me)).toMatchObject({ ok: false });
    expect(await updateLead(db, l.id, { ownerId: sara }, me)).toMatchObject({ ok: true });
    const n = await db.select().from(s.notifications).where(and(eq(s.notifications.leadId, l.id), eq(s.notifications.userId, sara)));
    expect(n.length).toBe(1);
  });

  it("sorting by stage follows the pipeline order, not the alphabet", async () => {
    const mixed = await Promise.all(["offer_sent", "contacted", "consult_booked", "enrolled", "nurture"].map(async (stage) => ({ stage, id: (await mk()).id })));
    for (const m of mixed) await db.update(s.leads).set({ stage: m.stage }).where(eq(s.leads.id, m.id));
    const r = await listLeads(db, { sort: "stage", dir: "asc", q: "Audit Lead" });
    const pos = Object.fromEntries((await db.select().from(s.stages)).map((x) => [x.key, x.position]));
    const seen = r.rows.map((x) => pos[x.stage]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("fires stage rules only for the stage they name, and a from-stage condition works", async () => {
    await saveRule(db, null, { name: "Left nurture", trigger: "stage_changed", conditions: { from_stage: "nurture" }, actions: [{ type: "add_tag", tag: "back-from-nurture" }] }, me);
    const l = await mk();
    await fireRules(db, { trigger: "stage_changed", leadId: l.id, from: "new", to: "contacted" }, me);
    await fireRules(db, { trigger: "stage_changed", leadId: l.id, from: "nurture", to: "contacted" }, me);
    const [row] = await db.select().from(s.leads).where(eq(s.leads.id, l.id));
    expect(row.tags).toEqual(["back-from-nurture"]);
  });

  it("the rule editor's JSON: a full rule with several actions saves, edits completely, and junk is refused", async () => {
    const json = JSON.stringify({
      name: "Dentists from Instagram",
      trigger: "lead_created",
      conditions: { segment: "dentist", tag: "" },
      actions: [
        { type: "set_owner", userId: sara },
        { type: "add_tag", tag: "Dentist-IG" },
        { type: "create_follow_up", kind: "call", note: "Call within a day", dueInMinutes: 1440 },
      ],
    });
    const r = parseRuleJson(json)!;
    expect(r.actions[1]).toEqual({ type: "add_tag", tag: "dentist-ig" });
    expect(await saveRule(db, null, r, me)).toEqual({ ok: true });
    const [saved] = await db.select().from(s.workflowRules).where(eq(s.workflowRules.name, "Dentists from Instagram"));
    expect(saved.conditions).toEqual({ segment: "dentist" });
    const l = await mk({ segment: "dentist", ownerId: null });
    const [row] = await db.select().from(s.leads).where(eq(s.leads.id, l.id));
    expect(row.ownerId).toBe(sara);
    expect(row.tags).toContain("dentist-ig");
    // a custom rule can change trigger and actions entirely
    expect(await saveRule(db, saved.id, { name: "Now on replies", trigger: "inbound_logged", conditions: {}, actions: [{ type: "notify", title: "{name} wrote" }] }, me)).toEqual({ ok: true });
    const [after] = await db.select().from(s.workflowRules).where(eq(s.workflowRules.id, saved.id));
    expect(after.trigger).toBe("inbound_logged");
    expect((await ruleStats(db)).get(saved.id)?.fired).toBe(1);
    for (const bad of ["not json", JSON.stringify({ name: "x", trigger: "lead_created", conditions: {}, actions: [{ type: "delete_everything" }] }), JSON.stringify({ name: "x", trigger: "lead_created", conditions: {}, actions: Array(6).fill({ type: "cancel_cadence" }) })])
      expect(parseRuleJson(bad)).toBeNull();
  });
});
