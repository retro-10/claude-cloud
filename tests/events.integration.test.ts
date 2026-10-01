import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { addRegistrant, eventLeadIds, followUpAfterEvent, listEvents, markReminded, registrants, setAttendance } from "@/lib/events";
import { intake, saveForm } from "@/lib/lead-forms";
import { createLead } from "@/lib/leads";
import { mergeLeads } from "@/lib/merge";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("masterclass manager", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, mc: number, other: number, formId: number;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "e".repeat(48);
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users))[0].id;
    const eventAt = new Date("2026-10-15T16:00:00Z");
    [{ id: mc }] = await db.insert(s.campaigns).values({ label: "MC Oct", kind: "masterclass", eventAt }).returning();
    [{ id: other }] = await db.insert(s.campaigns).values({ label: "Ads", kind: "ads" }).returning();
    const f = await saveForm(db, null, { slug: "mc", title: "MC", campaignId: mc, askEmail: false, askCity: false, askSegment: false, askTier: false, active: true }, userId);
    if (!f.ok) throw new Error(f.error);
    formId = f.id;
    // via the form; tagged to the campaign by hand; an old lead from another campaign who signs up on the form;
    // and someone not registered at all
    for (const [k, phone] of [["form", "01055500001"], ["tagged", "01055500002"], ["old", "01055500003"], ["none", "01055500004"]] as const) {
      const l = await createLead(db, { fullName: `${k} person`, phone, campaignId: k === "tagged" ? mc : k === "old" ? other : null }, userId);
      if (!l.ok) throw new Error("setup");
      ids[k] = l.lead.id;
    }
    await intake(db, { name: "form person", phone: "01055500001", consent: true, attribution: {}, formId, campaignId: mc, channel: "form" });
    await intake(db, { name: "old person", phone: "01055500003", consent: true, attribution: {}, formId, campaignId: mc, channel: "form" });
  });
  afterAll(() => client.end());

  it("registrants: the form's sign-ups and the campaign's leads, including someone who came from another campaign", async () => {
    const names = (await registrants(db, mc)).map((r) => r.fullName).sort();
    expect(names).toEqual(["form person", "old person", "tagged person"]);
    expect(await eventLeadIds(db, mc, [ids.form, ids.none, ids.old, -1])).toEqual(expect.arrayContaining([ids.form, ids.old]));
    expect(await eventLeadIds(db, mc, [ids.none])).toEqual([]);
    // the old lead keeps its first campaign
    const [old] = await db.select().from(s.leads).where(eq(s.leads.id, ids.old));
    expect(old.campaignId).toBe(other);
  });

  it("registering by hand, reminders (logged as a WhatsApp sent) and attendance", async () => {
    await addRegistrant(db, mc, ids.none, userId);
    expect((await registrants(db, mc)).map((r) => r.id)).toContain(ids.none);
    await markReminded(db, mc, ids.form, userId);
    const acts = await db.select().from(s.activities).where(eq(s.activities.leadId, ids.form));
    expect(acts.some((a) => a.type === "whatsapp" && a.direction === "out")).toBe(true);
    await setAttendance(db, mc, [{ leadId: ids.form, attended: true }, { leadId: ids.tagged, attended: false }, { leadId: ids.old, attended: true }], userId);
    await db.insert(s.consults).values({ leadId: ids.form, scheduledAt: new Date("2026-10-17T10:00:00Z"), held: true });
    await db.insert(s.consults).values({ leadId: ids.old, scheduledAt: new Date("2026-09-01T10:00:00Z"), held: true }); // before the event: not counted
    const [e] = (await listEvents(db)).filter((x) => x.id === mc);
    expect(e).toMatchObject({ registered: 4, reminded: 1, attended: 2, noShow: 1, consultedAfter: 1 });
    expect((await registrants(db, mc)).find((r) => r.id === ids.form)).toMatchObject({ attended: true, consultedAfter: true });
    expect((await listEvents(db)).map((x) => x.id)).not.toContain(other); // only masterclasses and events
  });

  it("follow-up starts a cadence for those who came, skipping do-not-contact", async () => {
    const [t] = await db.select().from(s.cadenceTemplates).limit(1);
    await db.update(s.leads).set({ doNotContact: true }).where(eq(s.leads.id, ids.old));
    const r = await followUpAfterEvent(db, mc, "attended", t.id, userId);
    expect(r.done).toBe(1);
    expect((await db.select().from(s.followUps).where(eq(s.followUps.leadId, ids.form))).length).toBeGreaterThan(0);
    expect(await db.select().from(s.followUps).where(eq(s.followUps.leadId, ids.old))).toHaveLength(0);
  });

  it("merging two registrants of the same masterclass keeps one row, came if either came", async () => {
    const twin = await createLead(db, { fullName: "tagged twin", phone: "01055500009", campaignId: mc }, userId);
    if (!twin.ok) throw new Error("setup");
    await setAttendance(db, mc, [{ leadId: twin.lead.id, attended: true }], userId);
    const m = await mergeLeads(db, { survivorId: ids.tagged, loserId: twin.lead.id, pick: {} }, userId);
    if (!m.ok) throw new Error(m.error);
    const rows = await db.select().from(s.eventAttendance).where(eq(s.eventAttendance.leadId, ids.tagged));
    expect(rows).toMatchObject([{ campaignId: mc, attended: true }]);
  });
});
