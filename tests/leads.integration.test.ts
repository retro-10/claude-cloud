import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { changeStage, createLead, logActivity, setDeleted, updateLead } from "@/lib/leads";
import { listLeads } from "@/lib/lead-list";

// Scratch database only: schema is dropped and recreated. Set TEST_DATABASE_URL to run.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("lead service", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw-for-tests");
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  afterAll(() => client.end());

  it("creates a lead with a normalised phone, owner, and a creation stage event", async () => {
    const r = await createLead(db, { fullName: "د. محمد علي", phone: "010 0123 4567" }, userId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead.phoneWhatsapp).toBe("+201001234567");
    expect(r.lead.ownerId).toBe(userId);
    expect(r.lead.fullName).toBe("د. محمد علي");
    const ev = await db.select().from(s.stageEvents).where(eq(s.stageEvents.leadId, r.lead.id));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromStage: null, toStage: "new" });
  });

  it("warns on duplicate phone (any format) and duplicate email (any case)", async () => {
    const byPhone = await createLead(db, { fullName: "Other", phone: "+20 100 123 4567" }, userId);
    expect(byPhone).toMatchObject({ ok: false, error: "duplicate" });
    if (!byPhone.ok && byPhone.error === "duplicate") expect(byPhone.duplicates[0].matchedOn).toBe("phone");

    await createLead(db, { fullName: "Mail", email: "Sara@Example.com" }, userId);
    const byMail = await createLead(db, { fullName: "Mail2", email: "sara@example.COM" }, userId);
    expect(byMail).toMatchObject({ ok: false, error: "duplicate" });
  });

  it("rejects an unparseable phone", async () => {
    expect(await createLead(db, { fullName: "X", phone: "abc" }, userId)).toEqual({ ok: false, error: "invalid_phone" });
  });

  it("first outbound sets first_contact_at once; first inbound sets first_reply_at once; notes do neither", async () => {
    const r = await createLead(db, { fullName: "Timing", phone: "01111111111" }, userId);
    if (!r.ok) throw new Error("setup");
    const id = r.lead.id;
    const get = async () => (await db.select().from(s.leads).where(eq(s.leads.id, id)))[0];

    await logActivity(db, { leadId: id, type: "note", direction: "internal", body: "n" }, userId);
    expect((await get()).firstContactAt).toBeNull();

    const t1 = new Date("2026-09-29T10:00:00Z");
    const t2 = new Date("2026-09-29T11:00:00Z");
    await logActivity(db, { leadId: id, type: "whatsapp", direction: "out", at: t1 }, userId);
    await logActivity(db, { leadId: id, type: "whatsapp", direction: "out", at: t2 }, userId);
    expect((await get()).firstContactAt).toEqual(t1);
    expect((await get()).firstReplyAt).toBeNull();

    await logActivity(db, { leadId: id, type: "whatsapp", direction: "in", at: t2 }, userId);
    await logActivity(db, { leadId: id, type: "whatsapp", direction: "in", at: new Date("2026-09-30T00:00:00Z") }, userId);
    expect((await get()).firstReplyAt).toEqual(t2);
  });

  it("every stage change writes a stage_events row; lost needs a reason; won needs an enrolment", async () => {
    const r = await createLead(db, { fullName: "Mover", phone: "01222222222" }, userId);
    if (!r.ok) throw new Error("setup");
    const id = r.lead.id;

    expect(await changeStage(db, id, "contacted", userId)).toEqual({ ok: true });
    expect(await changeStage(db, id, "lost", userId)).toMatchObject({ ok: false });
    expect(await changeStage(db, id, "enrolled", userId)).toMatchObject({ ok: false });
    expect(await changeStage(db, id, "nonsense", userId)).toMatchObject({ ok: false });
    const [reason] = await db.select().from(s.lostReasons).limit(1);
    expect(await changeStage(db, id, "lost", userId, { lostReasonId: reason.id })).toEqual({ ok: true });

    const ev = await db.select().from(s.stageEvents).where(eq(s.stageEvents.leadId, id)).orderBy(s.stageEvents.id);
    expect(ev.map((e) => [e.fromStage, e.toStage])).toEqual([
      [null, "new"],
      ["new", "contacted"],
      ["contacted", "lost"],
    ]);
    const lead = (await db.select().from(s.leads).where(eq(s.leads.id, id)))[0];
    expect(lead).toMatchObject({ stage: "lost", lostReasonId: reason.id });
    expect(lead.closedAt).not.toBeNull();

    // moving back out of lost clears the reason and closed_at
    await changeStage(db, id, "nurture", userId);
    const back = (await db.select().from(s.leads).where(eq(s.leads.id, id)))[0];
    expect(back).toMatchObject({ stage: "nurture", lostReasonId: null, closedAt: null });
  });

  it("update blocks a phone that belongs to another lead but allows keeping your own", async () => {
    const a = await createLead(db, { fullName: "A", phone: "01333333333" }, userId);
    const b = await createLead(db, { fullName: "B", phone: "01444444444" }, userId);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await updateLead(db, b.lead.id, { phone: "01333333333" }, userId)).toMatchObject({ ok: false });
    expect(await updateLead(db, a.lead.id, { phone: "+201333333333", city: "Cairo" }, userId)).toEqual({ ok: true });
  });

  it("soft delete hides from the list, still flags duplicates, and restores", async () => {
    const r = await createLead(db, { fullName: "Ghost", phone: "01555555555" }, userId);
    if (!r.ok) throw new Error("setup");
    await setDeleted(db, r.lead.id, true, userId);
    expect((await listLeads(db, { q: "Ghost" })).total).toBe(0);
    expect((await listLeads(db, { q: "Ghost", deleted: "1" })).total).toBe(1);
    const again = await createLead(db, { fullName: "Ghost 2", phone: "01555555555" }, userId);
    expect(again).toMatchObject({ ok: false, error: "duplicate" });
    if (!again.ok && again.error === "duplicate") expect(again.duplicates[0].deleted).toBe(true);
    await setDeleted(db, r.lead.id, false, userId);
    expect((await listLeads(db, { q: "Ghost" })).total).toBe(1);
  });

  it("list search matches name, phone digits and notes; filters and sorting work", async () => {
    await createLead(db, { fullName: "Searchable Nour", phone: "01666666666", notes: "wants exocad مبتدئ" }, userId);
    expect((await listLeads(db, { q: "nour" })).total).toBe(1);
    expect((await listLeads(db, { q: "0166 666" })).total).toBe(1); // spaces ignored, digits compared
    expect((await listLeads(db, { q: "1666666" })).total).toBe(1);
    expect((await listLeads(db, { q: "مبتدئ" })).total).toBe(1);
    expect((await listLeads(db, { q: "%" })).total).toBe(0); // LIKE wildcards are escaped
    const asc = await listLeads(db, { sort: "name", dir: "asc" });
    const desc = await listLeads(db, { sort: "name", dir: "desc" });
    expect(asc.total).toBeLessThan(50); // everything fits one page, so asc is the reverse of desc
    expect(asc.rows.map((r) => r.id)).toEqual(desc.rows.map((r) => r.id).reverse());
    expect((await listLeads(db, { stage: "lost" })).rows.every((r) => r.stage === "lost")).toBe(true);
  });

  it("overdue filter finds leads with an open follow-up in the past", async () => {
    const r = await createLead(db, { fullName: "Overdue Omar", phone: "01777777777" }, userId);
    if (!r.ok) throw new Error("setup");
    await db.insert(s.followUps).values({ leadId: r.lead.id, dueAt: new Date(Date.now() - 86_400_000), createdBy: userId });
    const res = await listLeads(db, { overdue: "1" });
    expect(res.rows.map((x) => x.fullName)).toEqual(["Overdue Omar"]);
  });
});
