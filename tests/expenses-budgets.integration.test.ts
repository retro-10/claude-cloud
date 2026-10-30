import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { cancelRequest, decide, getRequest, submitRequest } from "@/lib/approvals";
import { campaignStats, saveCampaign } from "@/lib/campaigns";
import { campaignContent, saveContent } from "@/lib/content";
import { listEntries, saveEntry } from "@/lib/finance";
import { financeAttention } from "@/lib/finance-overview";
import { createUser } from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("expenses into the ledger, and campaign budgets", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  type P = { id: number; name: string };
  let retro: P, mo: P, nour: P, camp: number;
  const owner = () => ({ id: retro.id, name: retro.name, isOwner: true, isFinance: false });
  const ledgerRow = async (requestId: number) => {
    const [r] = await db.select().from(s.approvalRequests).where(eq(s.approvalRequests.id, requestId));
    if (!r.ledgerEntryId) return null;
    const [e] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.id, r.ledgerEntryId));
    return e;
  };

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await db.update(s.users).set({ active: false });
    const get = async (email: string) => {
      const [u] = await db.update(s.users).set({ active: true }).where(eq(s.users.email, email)).returning();
      return { id: u.id, name: u.name };
    };
    retro = await get("retro@orladent.local");
    mo = await get("mo@orladent.local");
    const n = await createUser(db, { name: "Nour", email: "nour@eb.local", role: "marketing", password: "long enough pw" }, null);
    if (!n.ok) throw new Error("user");
    nour = { id: n.id, name: "Nour" };
    const c = await saveCampaign(db, null, { label: "October masterclass", kind: "masterclass", status: "live", budgetEgp: 10_000 }, retro.id);
    if (!c.ok) throw new Error(c.error);
    camp = c.id;
  });
  afterAll(() => client.end());

  it("a money request takes a category from the ledger's list and a receipt that passes the file rules", async () => {
    expect(await submitRequest(db, nour, { type: "expense", title: "Printing", amountEgp: 500, category: "Marketing" })).toMatchObject({ ok: false, error: expect.stringContaining("category") });
    expect(await submitRequest(db, nour, { type: "expense", title: "Printing", amountEgp: 500 }, { name: "run.exe", bytes: Buffer.from("x") })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Receipt"),
    });
    expect(await db.select().from(s.approvalRequests)).toEqual([]); // nothing saved when the receipt is refused
    const r = await submitRequest(db, nour, { type: "expense", title: "Reel boost", amountEgp: 4_000, category: "Ads & promotion", campaignId: camp }, { name: "receipt.png", bytes: Buffer.from("png") });
    if (!r.ok) throw new Error(r.error);
    const got = await getRequest(db, r.id, owner());
    expect(got!.files.map((f) => [f.fileName, f.note])).toEqual([["receipt.png", "Receipt"]]);
    expect(got!.ledger).toBeNull();
  });

  it("waiting requests count against the campaign budget before anyone decides", async () => {
    const [c] = await campaignStats(db, camp);
    expect(c).toMatchObject({ budgetEgp: 10_000, spendEgp: 0, owedEgp: 0, pendingEgp: 4_000, remainingEgp: 6_000 });
    expect((await financeAttention(db)).waiting).toMatchObject({ count: 1, egp: 4_000 });
  });

  it("approving an expense puts an Owed cost in the ledger, to pay back to the person who asked, tagged to its campaign", async () => {
    const [req] = await db.select().from(s.approvalRequests);
    expect(await decide(db, mo, req.id, "approve")).toEqual({ ok: true });
    const e = await ledgerRow(req.id);
    expect(e).toMatchObject({ entry: "Reel boost", amountEgp: 4_000, section: "variable_costs", category: "Ads & promotion", status: "owed", fromTo: "Nour", reference: `Request #${req.id}`, campaignId: camp, createdBy: mo.id });
    expect((await getRequest(db, req.id, owner()))!.ledger).toMatchObject({ status: "owed", category: "Ads & promotion" });
    const [c] = await campaignStats(db, camp);
    expect(c).toMatchObject({ owedEgp: 4_000, pendingEgp: 0, remainingEgp: 6_000 });
    const att = await financeAttention(db);
    expect(att.waiting.count).toBe(0);
    expect(att.owedFromRequests).toEqual({ count: 1, egp: 4_000 });
    // finance pays Nour back: no longer "approved to pay", and it is spend now
    await saveEntry(db, e!.id, { ...e!, stream: undefined, status: "paid", date: new Date() }, mo.id);
    expect((await financeAttention(db)).owedFromRequests.count).toBe(0);
    expect((await campaignStats(db, camp))[0]).toMatchObject({ spendEgp: 4_000, owedEgp: 0 });
  });

  it("a purchase in a fixed-cost category lands in fixed costs; with no category it waits for finance to sort", async () => {
    const sub = await submitRequest(db, nour, { type: "purchase", title: "Canva yearly", amountEgp: 3_000, category: "Subscriptions" });
    const loose = await submitRequest(db, nour, { type: "purchase", title: "Ring light", amountEgp: 2_500, campaignId: camp });
    if (!sub.ok || !loose.ok) throw new Error("submit");
    await decide(db, retro, sub.id, "approve");
    await decide(db, retro, loose.id, "approve");
    expect(await ledgerRow(sub.id)).toMatchObject({ section: "fixed_costs", category: "Subscriptions", fromTo: null });
    const l = await ledgerRow(loose.id);
    expect(l).toMatchObject({ section: "variable_costs", category: "Uncategorised" });
    expect((await financeAttention(db)).uncategorised).toBe(1);
    expect((await listEntries(db, { uncategorised: true })).map((r) => r.e.entry)).toEqual(["Ring light"]);
    await saveEntry(db, l!.id, { ...l!, stream: undefined, category: "Equipment" }, mo.id);
    expect((await financeAttention(db)).uncategorised).toBe(0);
  });

  it("rejected and withdrawn requests stay out of the books and off the budget; leave never reaches the ledger", async () => {
    const no = await submitRequest(db, nour, { type: "expense", title: "Taxi", amountEgp: 300, campaignId: camp });
    const gone = await submitRequest(db, nour, { type: "expense", title: "Lunch", amountEgp: 200, campaignId: camp });
    const leave = await submitRequest(db, nour, { type: "leave", title: "Day off", startsOn: "2026-12-01" });
    if (!no.ok || !gone.ok || !leave.ok) throw new Error("submit");
    await decide(db, retro, no.id, "reject", "Not in the plan");
    await cancelRequest(db, nour, gone.id);
    await decide(db, retro, leave.id, "approve");
    expect(await ledgerRow(no.id)).toBeNull();
    expect(await ledgerRow(gone.id)).toBeNull();
    expect(await ledgerRow(leave.id)).toBeNull();
    expect((await campaignStats(db, camp))[0].pendingEgp).toBe(0);
  });

  it("a campaign past its budget (paid + owed + waiting) is flagged; ended campaigns are not", async () => {
    // paid 4,000 + owed 2,500 (ring light) so far; a 5,000 request takes it 1,500 over
    const big = await submitRequest(db, nour, { type: "expense", title: "Venue deposit", amountEgp: 5_000, category: "Ads & promotion", campaignId: camp });
    if (!big.ok) throw new Error(big.error);
    expect((await campaignStats(db, camp))[0].remainingEgp).toBe(-1_500);
    expect((await financeAttention(db)).overBudget).toEqual([{ id: camp, label: "October masterclass", overEgp: 1_500 }]);
    await saveCampaign(db, camp, { label: "October masterclass", kind: "masterclass", status: "ended", budgetEgp: 10_000 }, retro.id);
    expect((await financeAttention(db)).overBudget).toEqual([]);
  });

  it("a campaign lists its content pieces", async () => {
    const a = await saveContent(db, null, { title: "Teaser reel", platform: "instagram", format: "reel", status: "posted", campaignId: camp, publishAt: new Date("2026-10-01T10:00:00Z") }, nour.id);
    const b = await saveContent(db, null, { title: "Speaker carousel", platform: "instagram", format: "carousel", status: "idea", campaignId: camp }, nour.id);
    await saveContent(db, null, { title: "Unrelated", platform: "tiktok", format: "video", status: "idea" }, nour.id);
    if (!a.ok || !b.ok) throw new Error("content");
    expect((await campaignContent(db, camp)).map((p) => p.title)).toEqual(["Teaser reel", "Speaker carousel"]);
  });
});
