import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { createCohort } from "@/lib/cohorts";
import { enrolLead } from "@/lib/enrol";
import { deleteEntry, listCandidates, saveEntry, updateCandidate } from "@/lib/finance";
import { changeStage, createLead } from "@/lib/leads";
import { NotionHttp, pid, put } from "@/lib/notion/client";
import { hashFields, notionConfig, runNotionSync, type NotionConfig } from "@/lib/notion/sync";
import { withoutRelease11Rules } from "./base-rules";
import { FakeNotion } from "./fake-notion";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const cfg: NotionConfig = {
  token: "test",
  batchesDb: "aaaaaaaa-0000-0000-0000-000000000001",
  candidatesDb: "aaaaaaaa-0000-0000-0000-000000000002",
  ledgerDb: "aaaaaaaa-0000-0000-0000-000000000003",
  parentPage: "aaaaaaaa-0000-0000-0000-000000000004",
  leadsDb: null,
  syncLeads: true,
  appUrl: "https://crm.example.com",
};

d("Notion two-way sync", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const notion = new FakeNotion();
  const sync = () => runNotionSync(db, cfg, notion);
  const link = async (entity: string, localId: number) =>
    (await db.select().from(s.notionLinks).where(eq(s.notionLinks.localId, localId))).find((l) => l.entity === entity)!;
  let userId: number, cohortId: number, enrolmentId: number, leadId: number, paymentId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
    await client.unsafe("delete from cohorts");
    cohortId = (await createCohort(db, { name: "Batch 1", seatCap: 40, status: "live" }, userId)).id;
    const l = await createLead(db, { fullName: "Kero Adel", phone: "01012345678", email: "kero@example.com" }, userId);
    if (!l.ok) throw new Error("setup");
    leadId = l.lead.id;
    const e = await enrolLead(
      db,
      { leadId, cohortId, tier: "freelance_ready", amountEgp: 15000, paymentPlan: "installments", paidAmountEgp: 5000, paymentRef: "IP-1", finalInstalmentAt: new Date("2026-11-01T10:00:00Z") },
      userId,
    );
    if (!e.ok) throw new Error("enrol " + e.error);
    enrolmentId = (await listCandidates(db, { leadId }))[0].enrolmentId;
    paymentId = (await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.status, "received")))[0].id;
  });
  afterAll(() => client.end());

  it("is off without a token, and reads the database ids from the environment", () => {
    expect(notionConfig({})).toBeNull();
    const c = notionConfig({ NOTION_TOKEN: "secret", NOTION_LEDGER_DB: "abc", DOMAIN: "crm.orladent.com" })!;
    expect(c.ledgerDb).toBe("abc");
    expect(c.candidatesDb).toBe("ed8f45c4-e790-42e4-a0fe-841d14cbbc42");
    expect(c.appUrl).toBe("https://crm.orladent.com");
  });

  it("first run: creates the Leads database and sends batches, candidates, ledger and leads with their relations", async () => {
    const r = await sync();
    expect(r.errors).toEqual([]);
    expect([...notion.databases.values()].map((x) => x.title)).toEqual(["CRM Leads"]);

    const [batch] = notion.inDb(cfg.batchesDb);
    expect(notion.prop(batch.id, "Name").title![0].plain_text).toBe("Batch 1");
    expect(notion.prop(batch.id, "Seats").number).toBe(40);
    expect(notion.prop(batch.id, "Status").select!.name).toBe("Live");
    expect(notion.prop(batch.id, "Freelance Ready enrolled").number).toBe(1);

    const [cand] = notion.inDb(cfg.candidatesDb);
    expect(notion.prop(cand.id, "Tier").select!.name).toBe("Freelance Ready");
    expect(notion.prop(cand.id, "Payment plan").select!.name).toBe("Installments");
    expect(notion.prop(cand.id, "Number").number).toBe(201012345678);
    expect(notion.prop(cand.id, "Gmail").rich_text![0].plain_text).toBe("kero@example.com");
    expect(notion.prop(cand.id, "Final installment date").date!.start).toBe("2026-11-01");
    expect(pid(notion.prop(cand.id, "Batch").relation![0].id)).toBe(pid(batch.id));

    const ledger = notion.inDb(cfg.ledgerDb);
    expect(ledger).toHaveLength(2); // the 5,000 received now and the 10,000 expected
    for (const p of ledger) expect(pid(notion.prop(p.id, "Candidate").relation![0].id)).toBe(pid(cand.id));
    const statuses = ledger.map((p) => [notion.prop(p.id, "Status").select!.name, notion.prop(p.id, "Amount (EGP)").number]).sort();
    expect(statuses).toEqual([
      ["Expected", 10000],
      ["Received", 5000],
    ]);
    // the payment reference stays in the CRM
    expect(Object.keys(ledger[0].props)).not.toContain("Reference");

    const leadsDb = [...notion.databases.keys()][0];
    const [lead] = notion.inDb(leadsDb);
    expect(notion.prop(lead.id, "Stage").select!.name).toBe("Enrolled");
    expect(notion.prop(lead.id, "Open in CRM").url).toBe(`https://crm.example.com/leads/${leadId}`);
    expect(r.pushed).toBe(5);
  });

  it("a second run with nothing changed writes nothing", async () => {
    const before = notion.calls;
    const r = await sync();
    expect(r).toMatchObject({ pushed: 0, pulled: 0, created: 0, conflicts: 0, errors: [] });
    expect(notion.calls - before).toBe(4); // one query per database
  });

  it("an edit in Notion comes into the CRM; an edit in the CRM goes to Notion", async () => {
    const cand = await link("enrolment", enrolmentId);
    notion.edit(cand.pageId, { "Discount (EGP)": put.number(1000), Status: put.select("Graduated") });
    const pay = await link("ledger", paymentId);
    notion.edit(pay.pageId, { Notes: put.text("confirmed on the call") });
    let r = await sync();
    expect(r.errors).toEqual([]);
    expect(r.pulled).toBe(2);
    const [c] = await listCandidates(db, { leadId });
    expect(c).toMatchObject({ discountEgp: 1000, status: "graduated", due: 14000 });
    const [e] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.id, paymentId));
    expect(e.notes).toBe("confirmed on the call");
    expect(e.reference).toBe("IP-1"); // the CRM-only field survives a pull

    await updateCandidate(db, enrolmentId, { paymentPlan: "one_time" }, userId);
    r = await sync();
    expect(r.pushed).toBe(1);
    expect(notion.prop(cand.pageId, "Payment plan").select!.name).toBe("One-time");
  });

  it("a candidate added in Notion becomes an enrolled lead in its batch", async () => {
    const batch = await link("cohort", cohortId);
    notion.add(cfg.candidatesDb, {
      Name: put.title("Mona Samir"),
      Tier: put.select("Foundation"),
      "Payment plan": put.select("Free seat"),
      Number: put.number(201112223334),
      Batch: put.relation([batch.pageId]),
    });
    const r = await sync();
    expect(r.errors).toEqual([]);
    expect(r.created).toBe(1);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.fullName, "Mona Samir"));
    expect(lead).toMatchObject({ stage: "enrolled", phoneWhatsapp: "+201112223334" });
    const [c] = await listCandidates(db, { leadId: lead.id });
    expect(c).toMatchObject({ cohortId, tier: "foundation", paymentPlan: "free_seat", due: 0 });
    // the new lead is then mirrored to the Leads database, and the batch count follows
    expect(notion.prop(batch.pageId, "Enrolled").number).toBe(2);
  });

  it("the second sync never duplicates a candidate it matched (first sync against a filled Notion)", async () => {
    const before = await db.select().from(s.enrolments);
    await sync();
    expect(await db.select().from(s.enrolments)).toHaveLength(before.length);
    expect(notion.inDb(cfg.candidatesDb)).toHaveLength(before.length);
  });

  it("ledger rows: added in Notion, deleted in the CRM, deleted in Notion", async () => {
    const id = notion.add(cfg.ledgerDb, {
      Entry: put.title("Camera"),
      "Amount (EGP)": put.number(8000),
      Date: put.date("2026-09-10"),
      Section: put.select("Variable costs"),
      Category: put.select("Equipment"),
      Status: put.select("Paid"),
    });
    let r = await sync();
    expect(r.created).toBe(1);
    const [cam] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.entry, "Camera"));
    expect(cam).toMatchObject({ amountEgp: 8000, section: "variable_costs", status: "paid" });

    await deleteEntry(db, cam.id, userId);
    r = await sync();
    expect(notion.pages.get(pid(id))!.archived).toBe(true);

    const rent = await saveEntry(db, null, { entry: "Rent", amountEgp: 3000, section: "fixed_costs", category: "Salaries", status: "owed" }, userId);
    if (!rent.ok) throw new Error();
    await sync();
    const rentLink = await link("ledger", rent.id);
    notion.remove(rentLink.pageId);
    await saveEntry(db, rent.id, { entry: "Rent", amountEgp: 3000, section: "fixed_costs", category: "Salaries", status: "paid" }, userId);
    r = await sync();
    const [gone] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.id, rent.id));
    expect(gone.deletedAt).not.toBeNull(); // deleted in Notion = deleted here
  });

  it("an invalid page is reported, not imported", async () => {
    notion.add(cfg.ledgerDb, { Entry: put.title("Mystery"), "Amount (EGP)": put.number(10) });
    const r = await sync();
    expect(r.errors.some((e) => /has no Section/.test(e))).toBe(true);
    expect(await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.entry, "Mystery"))).toHaveLength(0);
  });

  it("a lead's stage is the CRM's: a change in Notion is put back, a name change comes in", async () => {
    const l = await link("lead", leadId);
    notion.edit(l.pageId, { Stage: put.select("Lost"), Name: put.title("Kero A. Adel") });
    await sync();
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, leadId));
    expect(lead).toMatchObject({ stage: "enrolled", fullName: "Kero A. Adel" });
    expect(notion.prop(l.pageId, "Stage").select!.name).toBe("Enrolled");
  });

  it("when both sides changed, the newer edit wins and it counts as a conflict", async () => {
    const x = await createLead(db, { fullName: "Conflict", phone: "01099990000" }, userId);
    if (!x.ok) throw new Error();
    await sync();
    const l = await link("lead", x.lead.id);
    await changeStage(db, x.lead.id, "contacted", userId); // CRM first
    await new Promise((r) => setTimeout(r, 5));
    notion.edit(l.pageId, { Notes: put.text("from notion") }); // Notion later: wins
    const r = await sync();
    expect(r.conflicts).toBe(1);
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, x.lead.id));
    expect(lead.notes).toBe("from notion");
    expect(lead.stage).toBe("contacted"); // Notion never moves stages
    expect(notion.prop(l.pageId, "Stage").select!.name).not.toBe("New");
  });

  it("each run is logged", async () => {
    const runs = await db.select().from(s.notionSyncRuns);
    expect(runs.length).toBeGreaterThan(5);
    expect(runs.every((r) => r.finishedAt)).toBe(true);
  });

  it("a phone typed in Notion without the country code is read as Egyptian", async () => {
    const batch = await link("cohort", cohortId);
    notion.add(cfg.candidatesDb, { Name: put.title("Local Number"), Tier: put.select("Foundation"), Number: put.number(1098765432), Batch: put.relation([batch.pageId]) });
    await sync();
    const [lead] = await db.select().from(s.leads).where(eq(s.leads.fullName, "Local Number"));
    expect(lead.phoneWhatsapp).toBe("+201098765432");
  });

  it("hashes ignore key order", () => {
    expect(hashFields({ a: 1, b: "x" })).toBe(hashFields({ b: "x", a: 1 }));
  });
});

describe("Notion HTTP client", () => {
  it("retries a rate-limited request after Retry-After, and sends the token only in the header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const answers = [
      new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
      new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async (u: string, init: RequestInit) => {
      calls.push({ url: u, init });
      return answers.shift()!;
    });
    vi.stubGlobal("fetch", fetchMock);
    const slept: number[] = [];
    const api = new NotionHttp("secret-token", "https://api.notion.test/v1", async (ms) => void slept.push(ms));
    expect(await api.query("db1", null)).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(slept).toContain(2000);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(calls[0].url).not.toContain("secret-token");
    vi.unstubAllGlobals();
  });

  it("gives up with the Notion message on a permanent error", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "unauthorized", message: "API token is invalid." }), { status: 401 }));
    const api = new NotionHttp("bad", "https://api.notion.test/v1", async () => {});
    await expect(api.update("p1", {})).rejects.toMatchObject({ status: 401, message: "API token is invalid." });
    vi.unstubAllGlobals();
  });
});
