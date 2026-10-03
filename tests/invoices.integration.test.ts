import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { financeBoard } from "@/lib/finance";
import { createInvoice, getInvoice, listInvoices, recordInvoicePayment, uninvoiced, voidInvoice } from "@/lib/invoices";
import { listClients } from "@/lib/production";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("production invoices", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, clinic: number, other: number, typeId: number;
  const cases: number[] = [];
  const now = cairoLocalToDate("2026-10-05T11:00")!;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    owner = (await db.select().from(s.users))[0].id;
    [{ id: clinic }, { id: other }] = await db.insert(s.productionClients).values([{ name: "Smile Clinic", paymentTermsDays: 14 }, { name: "Nile Lab" }]).returning();
    [{ id: typeId }] = await db.insert(s.caseTypes).values({ name: "Crown", unitPriceEgp: 900, designerPayEgp: 300 }).returning();
    const base = { caseTypeId: typeId, dueAt: now, status: "delivered" as const, deliveredAt: now };
    for (const [clientId, priceEgp, ref] of [[clinic, 1800, "job 1"], [clinic, 900, "job 2"], [clinic, 2700, "job 3"], [other, 900, "lab 1"]] as const) {
      const [c] = await db.insert(s.productionCases).values({ ...base, clientId, priceEgp, reference: ref }).returning();
      cases.push(c.id);
    }
    await db.insert(s.productionCases).values({ ...base, clientId: clinic, priceEgp: 500, status: "designing", deliveredAt: null }); // not delivered: never invoiced
  });
  afterAll(() => client.end());

  it("invoices the chosen delivered cases; numbered per year; due after the client's terms; owed in the ledger", async () => {
    expect(await createInvoice(db, clinic, [cases[0], cases[3]], null, owner, now)).toMatchObject({ ok: false }); // another client's case
    const r = await createInvoice(db, clinic, [cases[0], cases[1]], "Thanks!", owner, now);
    if (!r.ok) throw new Error(r.error);
    expect(r.number).toBe("INV-2026-0001");
    const inv = (await getInvoice(db, r.id))!;
    expect(inv).toMatchObject({ totalEgp: 2700, clientName: "Smile Clinic", paid: 0, owed: 2700, notes: "Thanks!" });
    expect(inv.lines.map((l) => [l.code, l.amountEgp])).toEqual([[`PC-${String(cases[0]).padStart(4, "0")}`, 1800], [`PC-${String(cases[1]).padStart(4, "0")}`, 900]]);
    expect(inv.dueAt.toISOString()).toBe(cairoLocalToDate("2026-10-19T18:00")!.toISOString());
    const [row] = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.invoiceId, r.id));
    expect(row).toMatchObject({ section: "income", category: "OrlaDent client work", status: "expected", amountEgp: 2700, reference: "INV-2026-0001" });
    expect((await db.select().from(s.productionCases).where(eq(s.productionCases.invoiceId, r.id))).map((c) => c.status)).toEqual(["invoiced", "invoiced"]);
    // a case cannot go on a second invoice
    expect(await createInvoice(db, clinic, [cases[0]], null, owner, now)).toMatchObject({ ok: false });
    expect((await uninvoiced(db, clinic)).map((x) => x.c.id)).toEqual([cases[2]]);
  });

  it("all of a client's delivered cases at once; the next number", async () => {
    const r = await createInvoice(db, clinic, null, null, owner, now);
    if (!r.ok) throw new Error(r.error);
    expect(r.number).toBe("INV-2026-0002");
    expect((await getInvoice(db, r.id))!.totalEgp).toBe(2700);
    expect(await createInvoice(db, clinic, null, null, owner, now)).toEqual({ ok: false, error: "No delivered cases to invoice" });
  });

  it("part payments and full payment settle the expected row; never more than owed", async () => {
    const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.number, "INV-2026-0001"));
    expect(await recordInvoicePayment(db, inv.id, { amountEgp: 3000 }, owner)).toMatchObject({ ok: false });
    expect(await recordInvoicePayment(db, inv.id, { amountEgp: 1000, reference: "IP-123" }, owner)).toEqual({ ok: true, owed: 1700 });
    let rows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.invoiceId, inv.id));
    expect(rows.map((r) => [r.status, r.amountEgp]).sort()).toEqual([["expected", 1700], ["received", 1000]]);
    expect(await recordInvoicePayment(db, inv.id, { amountEgp: 1700 }, owner)).toEqual({ ok: true, owed: 0 });
    rows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.invoiceId, inv.id));
    expect(rows.every((r) => r.status === "received")).toBe(true);
    expect(rows.reduce((a, r) => a + r.amountEgp, 0)).toBe(2700);
    expect(await recordInvoicePayment(db, inv.id, { amountEgp: 1 }, owner)).toMatchObject({ ok: false });
    // a paid invoice cannot be voided
    expect(await voidInvoice(db, inv.id, "mistake", owner)).toMatchObject({ ok: false });
  });

  it("void before payment: rows cancelled, cases back to delivered, number never reused", async () => {
    const [inv] = await db.select().from(s.invoices).where(eq(s.invoices.number, "INV-2026-0002"));
    expect(await voidInvoice(db, inv.id, " ", owner)).toMatchObject({ ok: false });
    expect(await voidInvoice(db, inv.id, "Wrong client", owner)).toEqual({ ok: true });
    expect((await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.invoiceId, inv.id)))[0].status).toBe("cancelled");
    expect((await uninvoiced(db, clinic)).map((x) => x.c.id)).toEqual([cases[2]]);
    const again = await createInvoice(db, clinic, null, null, owner, now);
    expect(again).toMatchObject({ ok: true, number: "INV-2026-0003" });
  });

  it("lists with paid / owed / overdue; client balances; the books see client work", async () => {
    const list = await listInvoices(db, {}, cairoLocalToDate("2026-11-01T00:00")!);
    expect(list.map((i) => [i.number, i.status, i.paid, i.owed, i.overdue])).toEqual([
      ["INV-2026-0003", "issued", 0, 2700, true],
      ["INV-2026-0002", "void", 0, 0, false],
      ["INV-2026-0001", "issued", 2700, 0, false],
    ]);
    const clients = await listClients(db);
    expect(clients.find((c) => c.id === clinic)).toMatchObject({ owed: 2700, toInvoice: 0 });
    expect(clients.find((c) => c.id === other)).toMatchObject({ owed: 0, toInvoice: 1 });
    const board = await financeBoard(db, "2026-10");
    expect(board.allTime.income).toBe(2700); // received client work counts as income
    expect(board.comingUp.some((e) => e.reference === "INV-2026-0003" && e.status === "expected")).toBe(true);
    expect((await db.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.category, "OrlaDent client work"), eq(s.ledgerEntries.status, "received")))).length).toBe(2);
  });
});
