import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { allRequests, cancelRequest, decide, getRequest, matchRule, myRequests, reply, resolveApprovers, submitRequest, waitingCount, waitingFor } from "@/lib/approvals";
import { createUser } from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("approval routing rules", () => {
  const rules = [
    { type: "purchase", minAmountEgp: 20000, approvers: ["owners"] },
    { type: "purchase", minAmountEgp: null, approvers: ["finance"] },
    { type: "*", minAmountEgp: null, approvers: ["owners"] },
  ];
  it("the first rule whose type and minimum match decides", () => {
    expect(matchRule(rules, "purchase", 25000)).toBe(rules[0]);
    expect(matchRule(rules, "purchase", 500)).toBe(rules[1]);
    expect(matchRule(rules, "leave", null)).toBe(rules[2]);
  });
});

d("approvals: ask, route, decide, answer, record", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  type P = { id: number; name: string };
  let retro: P, badr: P, mo: P, mona: P, omar: P;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    // only these people are active: two owners, finance, a sales rep and a designer
    await db.update(s.users).set({ active: false });
    const get = async (email: string) => {
      const [u] = await db.update(s.users).set({ active: true }).where(eq(s.users.email, email)).returning();
      return { id: u.id, name: u.name };
    };
    retro = await get("retro@orladent.local");
    badr = await get("badr@orladent.local");
    mo = await get("mo@orladent.local");
    const m = await createUser(db, { name: "Mona", email: "mona@ap.local", role: "sales", password: "long enough pw" }, null);
    const o = await createUser(db, { name: "Omar", email: "omar@ap.local", role: "designer", password: "long enough pw" }, null);
    if (!m.ok || !o.ok) throw new Error("users");
    mona = { id: m.id, name: "Mona" };
    omar = { id: o.id, name: "Omar" };
  });
  afterAll(() => client.end());

  it("an expense goes to finance and the owners; leave and brand requests go to the owners; never to the requester", async () => {
    expect((await resolveApprovers(db, "expense", 500, mona.id)).sort()).toEqual([retro.id, badr.id, mo.id].sort());
    expect((await resolveApprovers(db, "leave", null, omar.id)).sort()).toEqual([retro.id, badr.id].sort());
    expect((await resolveApprovers(db, "leave", null, retro.id))).toEqual([badr.id]);
    expect((await resolveApprovers(db, "expense", 500, mo.id)).sort()).toEqual([retro.id, badr.id].sort());
  });

  it("checks the form: type, title, amount for money, dates for leave", async () => {
    expect(await submitRequest(db, mona, { type: "bribe", title: "x" })).toMatchObject({ ok: false });
    expect(await submitRequest(db, mona, { type: "expense", title: " " })).toMatchObject({ ok: false });
    expect(await submitRequest(db, mona, { type: "expense", title: "Printing", amountEgp: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("amount") });
    expect(await submitRequest(db, mona, { type: "leave", title: "Off" })).toMatchObject({ ok: false, error: expect.stringContaining("first day") });
    expect(await submitRequest(db, mona, { type: "leave", title: "Off", startsOn: "2026-11-10", endsOn: "2026-11-09" })).toMatchObject({ ok: false });
  });

  it("an expense: approvers are told, the queue is by waiting time, one decides, the requester is told", async () => {
    const a = await submitRequest(db, mona, { type: "expense", title: "Masterclass printing", amountEgp: 1200, category: "Ads & promotion" });
    const b = await submitRequest(db, omar, { type: "expense", title: "Wacom pen", amountEgp: 900 });
    if (!a.ok || !b.ok) throw new Error("submit");
    expect((await waitingFor(db, mo.id)).map((r) => r.title)).toEqual(["Masterclass printing", "Wacom pen"]);
    expect(await waitingCount(db, mona.id)).toBe(0);
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, mo.id), eq(s.notifications.kind, "approval_request")));
    expect(notes.map((n) => [n.title, n.link])).toContainEqual(["Mona asks: Masterclass printing", `/approvals/${a.id}`]);

    expect(await decide(db, mona, a.id, "approve")).toEqual({ ok: false, error: "You cannot decide your own request" });
    expect(await decide(db, omar, a.id, "approve")).toMatchObject({ ok: false, error: expect.stringContaining("not an approver") });
    expect(await decide(db, mo, a.id, "reject")).toMatchObject({ ok: false, error: "Say why it is rejected" });
    expect(await decide(db, mo, a.id, "approve")).toEqual({ ok: true });
    expect(await decide(db, retro, a.id, "approve")).toMatchObject({ ok: false, error: expect.stringContaining("already approved") });
    // everyone's "waiting for you" note for it is cleared; Mona hears the answer
    const left = await db.select().from(s.notifications).where(and(eq(s.notifications.link, `/approvals/${a.id}`), eq(s.notifications.kind, "approval_request")));
    expect(left.every((n) => n.readAt)).toBe(true);
    const [told] = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, mona.id), eq(s.notifications.kind, "approval_approved")));
    expect(told.title).toBe("Mo approved: Masterclass printing");
  });

  it("a question goes back to the requester; the answer returns it to the queue; reject needs a reason", async () => {
    const [wacom] = await waitingFor(db, mo.id);
    expect(await decide(db, mo, wacom.id, "needs_info", "")).toMatchObject({ ok: false });
    expect(await decide(db, mo, wacom.id, "needs_info", "Which model?")).toEqual({ ok: true });
    expect(await waitingFor(db, mo.id)).toEqual([]);
    expect(await reply(db, mona, wacom.id, "x")).toMatchObject({ ok: false });
    expect(await reply(db, omar, wacom.id, "Intuos M, for the case files")).toEqual({ ok: true });
    expect((await waitingFor(db, mo.id)).map((r) => r.id)).toEqual([wacom.id]);
    expect(await decide(db, badr, wacom.id, "reject", "We have a spare one")).toEqual({ ok: true });
    const r = await getRequest(db, wacom.id, { id: omar.id, name: "Omar", isOwner: false, isFinance: false });
    expect(r?.events.map((e) => [e.who, e.action, e.note])).toEqual([
      ["Omar", "submit", null],
      ["Mo", "needs_info", "Which model?"],
      ["Omar", "reply", "Intuos M, for the case files"],
      ["Badr", "reject", "We have a spare one"],
    ]);
    expect(r).toMatchObject({ status: "rejected", decider: "Badr" });
  });

  it("the record cannot be edited or deleted, even directly in the database", async () => {
    await expect(client`update approval_events set note = 'changed'`).rejects.toThrow(/append-only/);
    await expect(client`delete from approval_events`).rejects.toThrow(/append-only/);
  });

  it("approved leave lands on the team calendar", async () => {
    const r = await submitRequest(db, omar, { type: "leave", title: "Annual leave", startsOn: "2026-11-10", endsOn: "2026-11-12" });
    if (!r.ok) throw new Error(r.error);
    expect(await decide(db, retro, r.id, "approve")).toEqual({ ok: true });
    const [req] = await db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, r.id));
    const [ev] = await db.select().from(s.calendarEvents).where(eq(s.calendarEvents.id, req.calendarEventId!));
    expect(ev).toMatchObject({ userId: omar.id, kind: "leave", allDay: true, title: "Annual leave" });
  });

  it("who sees what: the requester and approvers; owners all; finance every money request", async () => {
    const leave = (await myRequests(db, omar.id)).find((r) => r.type === "leave")!;
    const asMona = { id: mona.id, name: "Mona", isOwner: false, isFinance: false };
    const asMo = { id: mo.id, name: "Mo", isOwner: false, isFinance: true };
    expect(await getRequest(db, leave.id, asMona)).toBeNull();
    expect(await getRequest(db, leave.id, asMo)).toBeNull(); // leave is not a money request
    expect((await allRequests(db, asMo)).every((r) => r.type === "expense" || r.type === "purchase")).toBe(true);
    expect((await allRequests(db, { id: retro.id, name: "Retro", isOwner: true, isFinance: true })).length).toBe(3);
  });

  it("withdrawing: only the requester, only while open", async () => {
    const r = await submitRequest(db, mona, { type: "purchase", title: "Ring light", amountEgp: 3000 });
    if (!r.ok) throw new Error(r.error);
    expect(await cancelRequest(db, omar, r.id)).toMatchObject({ ok: false });
    expect(await cancelRequest(db, mona, r.id)).toEqual({ ok: true });
    expect(await decide(db, mo, r.id, "approve")).toMatchObject({ ok: false });
  });

  it("rules are validated; amounts route bigger purchases elsewhere; a rule change does not move waiting requests", async () => {
    expect(await saveSettings(db, { approvalRules: [{ type: "purchase", minAmountEgp: null, approvers: ["owners"] }] }, retro.id)).toMatchObject({ ok: false }); // no catch-all last
    expect(await saveSettings(db, { approvalRules: [{ type: "*", minAmountEgp: null, approvers: [] }] }, retro.id)).toMatchObject({ ok: false });
    const waiting = await submitRequest(db, mona, { type: "purchase", title: "Tripod", amountEgp: 25000 });
    if (!waiting.ok) throw new Error(waiting.error);
    expect(
      await saveSettings(
        db,
        {
          approvalRules: [
            { type: "purchase", minAmountEgp: 20000, approvers: [`user:${badr.id}`] },
            { type: "purchase", minAmountEgp: null, approvers: ["finance"] },
            { type: "*", minAmountEgp: null, approvers: ["owners"] },
          ],
        },
        retro.id,
      ),
    ).toEqual({ ok: true });
    expect(await resolveApprovers(db, "purchase", 25000, mona.id)).toEqual([badr.id]);
    expect(await resolveApprovers(db, "purchase", 500, mona.id)).toEqual([mo.id]);
    // a rule naming only the requester falls back to the owners
    expect((await resolveApprovers(db, "purchase", 25000, badr.id))).toEqual([retro.id]);
    const [req] = await db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, waiting.id));
    expect(req.approverIds.sort()).toEqual([retro.id, badr.id, mo.id].sort());
  });
});
