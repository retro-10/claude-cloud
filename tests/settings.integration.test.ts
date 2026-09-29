import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { authenticate } from "@/lib/auth";
import { applyCadence } from "@/lib/followups";
import { createLead } from "@/lib/leads";
import { listAudit } from "@/lib/audit-log";
import {
  addCampaign, addListItem, changeOwnPassword, createUser, deleteCampaign, deleteListItem, deleteTemplate,
  moveStage, parseSteps, renameListItem, renameStage, resetPassword, saveTemplate, stepsToText, updateUser,
} from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("cadence step parsing", () => {
  it("parses day | kind | hint lines, defaults the kind, sorts by day", () => {
    const r = parseSteps("4 | call | Value clip\n0\n1 | whatsapp | Hello | with a bar");
    expect(r).toEqual({
      ok: true,
      steps: [
        { offset_days: 0, kind: "whatsapp", message_hint: "" },
        { offset_days: 1, kind: "whatsapp", message_hint: "Hello | with a bar" },
        { offset_days: 4, kind: "call", message_hint: "Value clip" },
      ],
    });
  });
  it("round-trips through text", () => {
    const steps = [{ offset_days: 2, kind: "email", message_hint: "Proof" }];
    expect(parseSteps(stepsToText(steps))).toEqual({ ok: true, steps });
  });
  it.each([["", /at least one/], ["x | whatsapp", /day number/], ["400 | whatsapp", /0-365/], ["1 | telegram", /kind must be/], ["-1 | call", /day number/]])(
    "rejects %j",
    (text, msg) => {
      const r = parseSteps(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    },
  );
});

d("settings and admin", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "seeded-password");
    owner = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  afterAll(() => client.end());

  it("creates users with a hashed password; rejects duplicates, weak passwords, bad emails", async () => {
    const r = await createUser(db, { name: "Nour", email: "  Nour@Orladent.local ", role: "sales", password: "correct horse" }, owner);
    expect(r.ok).toBe(true);
    const [u] = await db.select().from(s.users).where(eq(s.users.email, "nour@orladent.local"));
    expect(u).toMatchObject({ name: "Nour", role: "sales", active: true, passwordChangedAt: null });
    expect(u.passwordHash).not.toContain("correct horse");
    expect(await authenticate(db, "nour@orladent.local", "correct horse")).not.toBeNull();

    expect(await createUser(db, { name: "Dup", email: "NOUR@orladent.local", role: "sales", password: "another long one" }, owner)).toEqual({ ok: false, error: "That email is already used" });
    expect(await createUser(db, { name: "W", email: "w@orladent.local", role: "sales", password: "short" }, owner)).toMatchObject({ ok: false, error: expect.stringMatching(/at least 10/) });
    expect(await createUser(db, { name: "B", email: "not-an-email", role: "sales", password: "long enough pw" }, owner)).toMatchObject({ ok: false });
    expect(await createUser(db, { name: " ", email: "b@orladent.local", role: "sales", password: "long enough pw" }, owner)).toMatchObject({ ok: false });
  });

  it("always keeps at least one active owner", async () => {
    const owners = await db.select().from(s.users).where(eq(s.users.role, "owner"));
    expect(owners.length).toBeGreaterThanOrEqual(3);
    // deactivate / demote all but one: allowed
    for (const o of owners.slice(1)) expect(await updateUser(db, o.id, { active: false }, owner)).toEqual({ ok: true });
    // the last one cannot be demoted or deactivated
    expect(await updateUser(db, owners[0].id, { role: "sales" }, owner)).toEqual({ ok: false, error: "There must be at least one active owner" });
    expect(await updateUser(db, owners[0].id, { active: false }, owner)).toMatchObject({ ok: false });
    // but it can be renamed, and other owners can be re-activated
    expect(await updateUser(db, owners[0].id, { name: "Retro" }, owner)).toEqual({ ok: true });
    for (const o of owners.slice(1)) await updateUser(db, o.id, { active: true }, owner);
    expect(await updateUser(db, 99999, { active: false }, owner)).toEqual({ ok: false, error: "User not found" });
  });

  it("a deactivated user cannot sign in", async () => {
    const [n] = await db.select().from(s.users).where(eq(s.users.email, "nour@orladent.local"));
    await updateUser(db, n.id, { active: false }, owner);
    expect(await authenticate(db, "nour@orladent.local", "correct horse")).toBeNull();
    await updateUser(db, n.id, { active: true }, owner);
  });

  it("owner reset and own change: old password stops working, weak/wrong input is refused", async () => {
    const [n] = await db.select().from(s.users).where(eq(s.users.email, "nour@orladent.local"));
    expect(await resetPassword(db, n.id, "abc", owner)).toMatchObject({ ok: false });
    expect(await resetPassword(db, n.id, "brand new secret", owner)).toEqual({ ok: true });
    expect(await authenticate(db, "nour@orladent.local", "correct horse")).toBeNull();
    const signedIn = await authenticate(db, "nour@orladent.local", "brand new secret");
    expect(signedIn).not.toBeNull();

    expect(await changeOwnPassword(db, n.id, "wrong current", "a much longer one")).toEqual({ ok: false, error: "Current password is wrong" });
    expect(await changeOwnPassword(db, n.id, "brand new secret", "brand new secret")).toMatchObject({ ok: false });
    expect(await changeOwnPassword(db, n.id, "brand new secret", "short")).toMatchObject({ ok: false });
    expect(await changeOwnPassword(db, n.id, "brand new secret", "my very own password")).toEqual({ ok: true });
    const [after] = await db.select().from(s.users).where(eq(s.users.id, n.id));
    expect(after.passwordChangedAt).not.toBeNull();
    // the fingerprint in old sessions no longer matches
    const again = await authenticate(db, "nour@orladent.local", "my very own password");
    expect(again!.pv).not.toBe(signedIn!.pv);
    // reset marks the user as needing to choose their own again
    await resetPassword(db, n.id, "temporary reset one", owner);
    expect((await db.select().from(s.users).where(eq(s.users.id, n.id)))[0].passwordChangedAt).toBeNull();
  });

  it("stage rename and reordering keep a strict 1..n order and never touch keys or kinds", async () => {
    const keys = async () => (await db.select().from(s.stages).orderBy(s.stages.position)).map((x) => x.key);
    const before = await keys();
    expect(before[0]).toBe("new");
    expect(await renameStage(db, "replied", "  Answered  ", owner)).toEqual({ ok: true });
    expect((await db.select().from(s.stages).where(eq(s.stages.key, "replied")))[0].label).toBe("Answered");
    expect(await renameStage(db, "replied", " ", owner)).toMatchObject({ ok: false });
    expect(await renameStage(db, "nope", "X", owner)).toMatchObject({ ok: false });

    expect(await moveStage(db, "contacted", "up", owner)).toEqual({ ok: true });
    const after = await keys();
    expect(after.slice(0, 2)).toEqual(["contacted", "new"]);
    expect([...after].sort()).toEqual([...before].sort()); // same stages
    const positions = (await db.select().from(s.stages)).map((x) => x.position).sort((a, b) => a - b);
    expect(positions).toEqual(positions.map((_, i) => i + 1));
    expect(await moveStage(db, "contacted", "up", owner)).toEqual({ ok: true }); // already first: no-op
    expect(await keys()).toEqual(after);
    await moveStage(db, "contacted", "down", owner); // put it back
    expect(await keys()).toEqual(before);
    expect((await db.select().from(s.stages).where(eq(s.stages.key, "enrolled")))[0].kind).toBe("won");
  });

  it("lists: add, rename, duplicate refusal, and delete only when unused", async () => {
    expect(await addListItem(db, "sources", " TikTok ", owner)).toEqual({ ok: true });
    expect(await addListItem(db, "sources", "TikTok", owner)).toEqual({ ok: false, error: "That label already exists" });
    expect(await addListItem(db, "sources", "  ", owner)).toMatchObject({ ok: false });
    const [tt] = await db.select().from(s.sources).where(eq(s.sources.label, "TikTok"));
    expect(await renameListItem(db, "sources", tt.id, "Instagram", owner)).toEqual({ ok: false, error: "That label already exists" });
    expect(await renameListItem(db, "sources", tt.id, "TikTok ads", owner)).toEqual({ ok: true });

    const [ig] = await db.select().from(s.sources).where(eq(s.sources.label, "Instagram"));
    await createLead(db, { fullName: "L", phone: "01234000001", sourceId: ig.id }, owner);
    expect(await deleteListItem(db, "sources", ig.id, owner)).toMatchObject({ ok: false, error: expect.stringMatching(/In use by 1 record/) });
    expect(await deleteListItem(db, "sources", tt.id, owner)).toEqual({ ok: true });

    const [price] = await db.select().from(s.objections).where(eq(s.objections.label, "Price"));
    const [c] = await db.insert(s.consults).values({ leadId: (await db.select().from(s.leads))[0].id, scheduledAt: new Date() }).returning();
    await db.insert(s.consultObjections).values({ consultId: c.id, objectionId: price.id });
    expect(await deleteListItem(db, "objections", price.id, owner)).toMatchObject({ ok: false });
    expect(await deleteListItem(db, "lostReasons", 99999, owner)).toEqual({ ok: false, error: "Not found" });
  });

  it("campaigns: add, rename, delete only when no lead uses it", async () => {
    expect(await addCampaign(db, " Oct masterclass ", null, owner)).toEqual({ ok: true });
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.label, "Oct masterclass"));
    await createLead(db, { fullName: "Camp", phone: "01234000002", campaignId: c.id }, owner);
    expect(await deleteCampaign(db, c.id, owner)).toMatchObject({ ok: false });
    await db.update(s.leads).set({ campaignId: null }).where(eq(s.leads.campaignId, c.id));
    expect(await deleteCampaign(db, c.id, owner)).toEqual({ ok: true });
  });

  it("cadence templates: create, edit (new cadences use it, old follow-ups keep their dates), delete only when unused", async () => {
    expect(await saveTemplate(db, null, "Quick nudge", "0 | whatsapp | Hi\n2 | call | Ring", owner)).toEqual({ ok: true });
    expect(await saveTemplate(db, null, "Quick nudge", "0", owner)).toEqual({ ok: false, error: "A template with that name already exists" });
    expect(await saveTemplate(db, null, "Bad", "abc", owner)).toMatchObject({ ok: false });
    const [t] = await db.select().from(s.cadenceTemplates).where(eq(s.cadenceTemplates.name, "Quick nudge"));

    const lead = (await createLead(db, { fullName: "Cad", phone: "01234000003" }, owner)) as { ok: true; lead: { id: number } };
    await applyCadence(db, { leadId: lead.lead.id, templateId: t.id }, owner);
    expect(await db.select().from(s.followUps).where(eq(s.followUps.leadId, lead.lead.id))).toHaveLength(2);

    expect(await saveTemplate(db, t.id, "Quick nudge v2", "0 | whatsapp | Hi\n1 | whatsapp | B\n5 | email | C", owner)).toEqual({ ok: true });
    expect(await db.select().from(s.followUps).where(eq(s.followUps.leadId, lead.lead.id))).toHaveLength(2); // unchanged
    const lead2 = (await createLead(db, { fullName: "Cad2", phone: "01234000004" }, owner)) as { ok: true; lead: { id: number } };
    expect(await applyCadence(db, { leadId: lead2.lead.id, templateId: t.id }, owner)).toMatchObject({ ok: true, created: 3 });

    expect(await deleteTemplate(db, t.id, owner)).toMatchObject({ ok: false, error: expect.stringMatching(/follow-ups came from/) });
    await saveTemplate(db, null, "Throwaway", "0", owner);
    const [th] = await db.select().from(s.cadenceTemplates).where(eq(s.cadenceTemplates.name, "Throwaway"));
    expect(await deleteTemplate(db, th.id, owner)).toEqual({ ok: true });
  });

  it("every change above was audited, with ids and field names but no passwords or lead values", async () => {
    const { rows, entities } = await listAudit(db, {});
    expect(entities).toEqual(expect.arrayContaining(["user", "stage", "sources", "campaign", "cadence"]));
    const text = JSON.stringify(rows);
    for (const secret of ["correct horse", "brand new secret", "my very own password", "temporary reset one", "Nour@Orladent"]) expect(text).not.toContain(secret);
    expect(rows.some((r) => r.entity === "user" && r.action === "password_reset")).toBe(true);
    const filtered = await listAudit(db, { entity: "stage" });
    expect(filtered.rows.every((r) => r.entity === "stage")).toBe(true);
    expect(filtered.total).toBeGreaterThan(0);
    expect((await listAudit(db, { userId: owner })).rows.every((r) => r.user === "Retro")).toBe(true);
  });
});
