import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { ask, deleteThread, listThreads, threadMessages, toolsFor } from "@/lib/ai/ask";
import { AiError, aiStatus, callClaude, redact, setAiForTests, type BetaMessage } from "@/lib/ai/core";
import { DEFAULTS, getSettings, saveSettings } from "@/lib/app-settings";
import { draftCaption, draftConsultBrief, draftLeadMessage, draftScript, draftWeekly } from "@/lib/ai/drafts";
import { splitWeekly } from "@/lib/ai/split";
import { weekStartOf } from "@/lib/command";
import { createUser } from "@/lib/settings";
import type Anthropic from "@anthropic-ai/sdk";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("redaction (pure)", () => {
  it("removes emails and phone numbers, keeps dates, money and short numbers", () => {
    expect(redact("Call +20 100 123 4567 or mail mona@clinic.com")).toBe("Call [phone] or mail [email]");
    expect(redact("WhatsApp 01001234567, paid 12,500 EGP on 2026-09-01, 3 units")).toBe("WhatsApp [phone], paid 12,500 EGP on 2026-09-01, 3 units");
    expect(redact("due 01/10/2026; budget 12,500,000 EGP; call 0100 123 4567")).toBe("due 01/10/2026; budget 12,500,000 EGP; call [phone]");
  });
});

describe("weekly draft split (pure)", () => {
  it("finds the three sections, with or without markdown around the headings", () => {
    expect(splitWeekly("WINS\n- 12 leads\n\nMISSES\n- 0 consults\n\nDECISIONS\n- Hire")).toEqual({ wins: "- 12 leads", misses: "- 0 consults", decisions: "- Hire" });
    expect(splitWeekly("**WINS**\n- a\n## MISSES:\n- b")).toEqual({ wins: "- a", misses: "- b", decisions: "" });
  });
});

const msg = (content: unknown[], stop_reason: string): BetaMessage =>
  ({ id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } }) as unknown as BetaMessage;
const text = (t: string) => msg([{ type: "text", text: t, citations: null }], "end_turn");
const use = (name: string, input: object) => msg([{ type: "tool_use", id: `tu_${name}`, name, input }], "tool_use");

/** A fake Claude that replays scripted replies and remembers what it was sent. */
function script(...replies: (BetaMessage | Error)[]) {
  const sent: Params[] = [];
  setAiForTests(async (p) => {
    sent.push(structuredClone(p));
    const r = replies.shift();
    if (!r) throw new Error("no more scripted replies");
    if (r instanceof Error) throw r;
    return r;
  });
  return sent;
}

d("the AI assistant", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, sales: number, leadId: number, cohortId: number;
  const viewer = (id: number, role: "owner" | "sales" | "designer" | "finance") => ({ id, name: "Tester", role });

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    owner = (await db.select().from(s.users).where(eq(s.users.role, "owner")))[0].id;
    const r = await createUser(db, { name: "Sara Sales", email: "sara@test.local", role: "sales", password: "a-long-password-1" }, owner);
    if (!r.ok) throw new Error(r.error);
    sales = r.id;
    [{ id: leadId }] = await db.insert(s.leads).values({ fullName: "Dr Mona Adel", notes: "Her number is 01001234567, email mona@x.com" }).returning();
    [{ id: cohortId }] = await db.insert(s.cohorts).values({ name: "Batch 7", seatCap: 30 }).returning();
  });
  afterEach(() => setAiForTests(null));
  afterAll(() => client.end());

  it("is off until an owner switches it on, and says why", async () => {
    script();
    const st = await aiStatus(db);
    expect(st.ok).toBe(false);
    if (!st.ok) expect(st.reason).toMatch(/switched off/);
    await expect(callClaude(db, { userId: owner, feature: "ask", system: "x", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(AiError);
    expect(await db.select().from(s.aiUsage)).toHaveLength(0);
    expect(await saveSettings(db, { ai: { ...DEFAULTS.ai, enabled: true } }, owner)).toMatchObject({ ok: true });
    expect((await aiStatus(db)).ok).toBe(true);
  });

  it("settings refuse a bad daily limit", async () => {
    expect(await saveSettings(db, { ai: { ...DEFAULTS.ai, enabled: true, dailyLimit: 0 } }, owner)).toMatchObject({ ok: false });
  });

  it("tools follow the person's role and the owners' choices", async () => {
    const { ai } = await getSettings(db);
    const names = (role: "owner" | "sales" | "designer" | "finance", a = ai) => toolsFor(db, viewer(owner, role), a).map((t) => t.tool.name);
    expect(names("owner")).toEqual(["sales_numbers", "needs_attention", "batches", "campaigns", "find_leads", "lead_history", "students", "production"]);
    // money only when the owners allow it AND the person may see money
    expect(names("owner", { ...ai, readMoney: true })).toContain("money_month");
    expect(names("sales", { ...ai, readMoney: true })).not.toContain("money_month");
    expect(names("sales")).not.toContain("production");
    expect(names("designer")).toEqual([]);
    expect(names("owner", { ...ai, readLeads: false, readStudents: false, readProduction: false })).toEqual(["sales_numbers", "needs_attention", "batches", "campaigns"]);
    // descriptions say when money is withheld
    const camp = toolsFor(db, viewer(sales, "sales"), { ...ai, readMoney: true }).find((t) => t.tool.name === "campaigns")!;
    expect(camp.tool.description).not.toMatch(/spend/);
    // every schema is closed
    for (const t of toolsFor(db, viewer(owner, "owner"), { ...ai, readMoney: true })) expect(t.tool.input_schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("answers with lookups: runs the tool, sends the result back, saves the conversation", async () => {
    const sent = script(use("lead_history", { lead_id: leadId }), text("Mona is [new](/leads/1)."));
    const { ai } = await getSettings(db);
    const r = await ask(db, viewer(sales, "sales"), null, "What do we know about Mona?", ai);
    expect(r.answer).toBe("Mona is [new](/leads/1).");
    expect(r.lookups).toEqual([{ tool: "lead_history", summary: "Dr Mona Adel's history" }]);
    // the tool result went back to Claude, without her phone or email
    const second = sent[1];
    const last = second.messages[second.messages.length - 1];
    const result = JSON.stringify(last.content);
    expect(result).toContain("Dr Mona Adel");
    expect(result).not.toMatch(/01001234567|mona@x\.com/);
    expect(result).toContain("[phone]");
    // the stable instructions are cached; the person and date come after the breakpoint
    const system = sent[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toMatch(/role: sales/);
    expect(sent[0]).toMatchObject({ model: expect.any(String), fallbacks: "default", output_config: { effort: "medium" } });
    // saved, and only for this person
    expect((await listThreads(db, sales)).map((t) => t.title)).toEqual(["What do we know about Mona?"]);
    expect(await threadMessages(db, owner, r.threadId)).toBeNull();
    const t = await threadMessages(db, sales, r.threadId);
    expect(t!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // a follow-up carries the earlier turns
    const sent2 = script(text("Yes."));
    await ask(db, viewer(sales, "sales"), r.threadId, "Is she new?", ai);
    expect(sent2[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // another person cannot add to it or delete it
    await expect(ask(db, viewer(owner, "owner"), r.threadId, "x", ai)).rejects.toThrow(/not found/);
    await deleteThread(db, owner, r.threadId);
    expect(await threadMessages(db, sales, r.threadId)).not.toBeNull();
    await deleteThread(db, sales, r.threadId);
    expect(await threadMessages(db, sales, r.threadId)).toBeNull();
  });

  it("a tool the person may not use is refused even if Claude asks for it", async () => {
    const sent = script(use("money_month", {}), text("I cannot see money."));
    const { ai } = await getSettings(db);
    const r = await ask(db, viewer(sales, "sales"), null, "How much did we make?", { ...ai, readMoney: true });
    expect(r.lookups).toEqual([]);
    expect(JSON.stringify(sent[1].messages.at(-1)!.content)).toMatch(/not available/);
    // students: batch rules come back
    script(use("students", { batch_id: cohortId }), text("ok"));
    expect((await ask(db, viewer(sales, "sales"), null, "students?", ai)).lookups[0].tool).toBe("students");
  });

  it("records tokens (never content); a refusal and an API error are recorded and explained", async () => {
    await db.delete(s.aiUsage);
    script(text("hi"));
    await callClaude(db, { userId: owner, feature: "reply", system: "x", messages: [{ role: "user", content: "secret words" }] });
    let rows = await db.select().from(s.aiUsage);
    expect(rows).toMatchObject([{ userId: owner, feature: "reply", inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, ok: true }]);
    expect(JSON.stringify(rows)).not.toContain("secret words");
    script(msg([], "refusal"));
    await expect(callClaude(db, { userId: owner, feature: "reply", system: "x", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/declined/);
    script(new Error("boom"));
    await expect(callClaude(db, { userId: owner, feature: "reply", system: "x", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/went wrong/);
    rows = await db.select().from(s.aiUsage);
    expect(rows.map((r) => r.ok)).toEqual([true, false, false]);
  });

  it("stops at the person's daily limit", async () => {
    await saveSettings(db, { ai: { ...DEFAULTS.ai, enabled: true, dailyLimit: 3 } }, owner);
    script(text("1"));
    await expect(callClaude(db, { userId: owner, feature: "ask", system: "x", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/today's 3 AI requests/);
    // someone else still can
    script(text("ok"));
    await expect(callClaude(db, { userId: sales, feature: "ask", system: "x", messages: [{ role: "user", content: "x" }] })).resolves.toBeTruthy();
    await saveSettings(db, { ai: { ...DEFAULTS.ai, enabled: true } }, owner);
  });

  it("gives up cleanly after too many lookups", async () => {
    script(...Array.from({ length: 6 }, () => use("batches", {})));
    const { ai } = await getSettings(db);
    const r = await ask(db, viewer(owner, "owner"), null, "loop", ai);
    expect(r.answer).toMatch(/could not finish/);
    expect(r.lookups).toHaveLength(6);
  });
  it("drafts a WhatsApp message from the conversation, in the brand voice, without contact details", async () => {
    await db.insert(s.activities).values({ leadId, type: "whatsapp", direction: "in", body: "How much is the camp? my email is mona@x.com" });
    const sent = script(text("Hi Mona! The fee is [price]."));
    const { ai } = await getSettings(db);
    const out = await draftLeadMessage(db, viewer(sales, "sales"), leadId, { lang: "en", kind: "reply" }, ai);
    expect(out).toBe("Hi Mona! The fee is [price].");
    const system = (sent[0].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(system).toContain(ai.brandVoice);
    expect(system).toMatch(/Never invent a price/);
    expect(system).toContain("How much is the camp?");
    expect(system).not.toMatch(/mona@x\.com|01001234567/);
    expect(sent[0].tools).toBeUndefined();
    // viewers do not message leads; do-not-contact leads get nothing
    await expect(draftLeadMessage(db, { id: owner, name: "V", role: "viewer" }, leadId, {}, ai)).rejects.toThrow(/Only people who message/);
    await db.update(s.leads).set({ doNotContact: true }).where(eq(s.leads.id, leadId));
    await expect(draftLeadMessage(db, viewer(sales, "sales"), leadId, {}, ai)).rejects.toThrow(/do-not-contact/);
    await db.update(s.leads).set({ doNotContact: false }).where(eq(s.leads.id, leadId));
  });

  it("captions use a student's words only with consent; scripts and weekly reviews are for the right people", async () => {
    const { ai } = await getSettings(db);
    const [p] = await db.insert(s.proofItems).values({ name: "Mona's win", quote: "I passed QC first time", consentStatus: "Asked" }).returning();
    const [c] = await db.insert(s.contentItems).values({ title: "Crown reel", proofItemId: p.id, brief: "Show the crown" }).returning();
    let sent = script(text("HOOKS\n1. a\n\nCAPTION\nb"));
    await draftCaption(db, viewer(sales, "sales"), c.id, { lang: "ar" }, ai);
    let sys = (sent[0].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(sys).not.toContain("I passed QC");
    expect(sys).toContain("Egyptian Arabic");
    await db.update(s.proofItems).set({ consentStatus: "Granted" }).where(eq(s.proofItems.id, p.id));
    sent = script(text("ok"));
    await draftCaption(db, viewer(sales, "sales"), c.id, {}, ai);
    expect((sent[0].system as { text: string }[]).map((b) => b.text).join("\n")).toContain("I passed QC first time");

    const [m] = await db.insert(s.campaigns).values({ label: "Crown masterclass", kind: "masterclass" }).returning();
    sent = script(text("0:00 Welcome"));
    expect(await draftScript(db, viewer(sales, "sales"), m.id, { minutes: "45" }, ai)).toBe("0:00 Welcome");
    expect((sent[0].system as { text: string }[]).map((b) => b.text).join("\n")).toMatch(/45-minute/);

    await expect(draftWeekly(db, viewer(sales, "sales"), weekStartOf(new Date()), ai)).rejects.toThrow(/Only owners/);
    sent = script(text("WINS\n- x"));
    await draftWeekly(db, viewer(owner, "owner"), weekStartOf(new Date()), ai);
    sys = (sent[0].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(sys).toContain("Cash collected");
  });
  it("a consult brief draws on past consults and the objections that usually come up", async () => {
    const { ai } = await getSettings(db);
    const [o] = await db.insert(s.objections).values({ label: "Price too high" }).onConflictDoNothing().returning();
    const objId = o?.id ?? (await db.select().from(s.objections).where(eq(s.objections.label, "Price too high")))[0].id;
    const [c] = await db.insert(s.consults).values({ leadId, scheduledAt: new Date(), held: true, outcome: "thinking", notes: "Worried about time; call 01001234567" }).returning();
    await db.insert(s.consultObjections).values({ consultId: c.id, objectionId: objId });
    const sent = script(text("WHO THEY ARE\n- Mona"));
    expect(await draftConsultBrief(db, viewer(sales, "sales"), leadId, ai)).toBe("WHO THEY ARE\n- Mona");
    const sys = (sent[0].system as { text: string }[]).map((b) => b.text).join("\n");
    expect(sys).toContain("Price too high");
    expect(sys).toContain("Worried about time");
    expect(sys).not.toContain("01001234567");
    await expect(draftConsultBrief(db, { id: owner, name: "I", role: "instructor" }, leadId, ai)).rejects.toThrow(/Only people who run consults/);
  });
});
