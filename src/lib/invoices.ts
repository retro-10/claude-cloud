import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { caseTypes, invoices, ledgerEntries, productionCases, productionClients, type InvoiceLine } from "@/db/schema";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { caseCode } from "./production";
import { dueAtFor } from "./production-quote";
import { addDaysYmd, cairoYmd } from "./time";

type Fail = { ok: false; error: string };

/**
 * Production invoices. An invoice is a document (number, lines, total, kept as issued); the money is in the
 * ledger: one Expected "OrlaDent client work" row for what is owed, settled into Received rows as the client pays.
 * So the Finance board, the coming-up list and the cash forecast all see invoices without knowing about them.
 */
export const CLIENT_WORK = "OrlaDent client work";

const lineFor = (c: { id: number; units: number; rush: boolean; reference: string | null; priceEgp: number }, type: string): InvoiceLine => ({
  caseId: c.id,
  code: caseCode(c.id),
  description: `${type} × ${c.units}${c.rush ? " (rush)" : ""}${c.reference ? ` · ${c.reference}` : ""}`,
  units: c.units,
  amountEgp: c.priceEgp,
});

/** The client's delivered cases not yet on an invoice. */
export async function uninvoiced(db: Db, clientId: number) {
  return db
    .select({ c: productionCases, type: caseTypes.name })
    .from(productionCases)
    .innerJoin(caseTypes, eq(caseTypes.id, productionCases.caseTypeId))
    .where(and(eq(productionCases.clientId, clientId), eq(productionCases.status, "delivered"), isNull(productionCases.invoiceId)))
    .orderBy(productionCases.deliveredAt);
}

/**
 * Invoice a client's delivered cases (all of them, or the ones chosen). Numbered INV-<year>-<0001> in the Cairo
 * year it is issued; due after the client's payment terms. The cases become Invoiced.
 */
export async function createInvoice(db: Db, clientId: number, caseIds: number[] | null, notes: string | null, userId: number | null, now = new Date()): Promise<{ ok: true; id: number; number: string } | Fail> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [client] = await tx.select().from(productionClients).where(eq(productionClients.id, clientId));
        if (!client) return { ok: false as const, error: "Client not found" };
        // lock the cases so two people invoicing at once cannot put a case on two invoices
        const rows = await tx
          .select({ c: productionCases, type: caseTypes.name })
          .from(productionCases)
          .innerJoin(caseTypes, eq(caseTypes.id, productionCases.caseTypeId))
          .where(and(eq(productionCases.clientId, clientId), eq(productionCases.status, "delivered"), isNull(productionCases.invoiceId), caseIds ? inArray(productionCases.id, caseIds.length ? caseIds : [0]) : undefined))
          .orderBy(productionCases.deliveredAt)
          .for("update", { of: productionCases });
        if (!rows.length) return { ok: false as const, error: "No delivered cases to invoice" };
        if (caseIds && rows.length !== new Set(caseIds).size) return { ok: false as const, error: "Some of those cases are not delivered or are already invoiced" };
        const lines = rows.map((r) => lineFor(r.c, r.type));
        const total = lines.reduce((a, l) => a + l.amountEgp, 0);
        const year = cairoYmd(now).slice(0, 4);
        const [{ n }] = await tx.execute<{ n: number }>(sql`select coalesce(max(substring(number from 10)::int), 0)::int + 1 as n from invoices where number like ${`INV-${year}-%`}`);
        const number = `INV-${year}-${String(n).padStart(4, "0")}`;
        const dueAt = dueAtFor(addDaysYmd(cairoYmd(now), client.paymentTermsDays));
        const [inv] = await tx
          .insert(invoices)
          .values({ number, clientId, clientName: client.name, issuedAt: now, dueAt, totalEgp: total, lines, notes: notes?.trim().slice(0, 2000) || null, createdBy: userId })
          .returning({ id: invoices.id });
        await tx.update(productionCases).set({ status: "invoiced", invoiceId: inv.id, updatedAt: new Date() }).where(inArray(productionCases.id, rows.map((r) => r.c.id)));
        await tx.insert(ledgerEntries).values({
          entry: `${number} — ${client.name}`.slice(0, 200),
          amountEgp: total,
          date: dueAt,
          section: "income",
          category: CLIENT_WORK,
          status: "expected",
          fromTo: client.name,
          reference: number,
          invoiceId: inv.id,
          createdBy: userId,
        });
        await audit(tx, { userId, entity: "invoice", entityId: inv.id, action: "issue", diff: { totalEgp: total, cases: rows.length } });
        return { ok: true as const, id: inv.id, number };
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 2) continue; // someone took the same number a moment ago
      throw e;
    }
  }
  return { ok: false, error: "Could not number the invoice; try again" };
}

/** What has been paid and what is still owed on an invoice (from its ledger rows). */
async function money(db: Pick<Db, "select">, invoiceId: number) {
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.invoiceId, invoiceId), isNull(ledgerEntries.deletedAt), eq(ledgerEntries.section, "income")));
  return {
    payments: rows.filter((r) => r.status === "received").sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0)),
    expected: rows.filter((r) => r.status === "expected"),
    paid: rows.filter((r) => r.status === "received").reduce((a, r) => a + r.amountEgp, 0),
    owed: rows.filter((r) => r.status === "expected").reduce((a, r) => a + r.amountEgp, 0),
  };
}

/** A payment against an invoice: all of what is owed, or part of it (the rest stays expected). */
export async function recordInvoicePayment(db: Db, invoiceId: number, p: { amountEgp: number; date?: Date | null; reference?: string | null }, userId: number | null): Promise<{ ok: true; owed: number } | Fail> {
  if (!Number.isInteger(p.amountEgp) || p.amountEgp <= 0) return { ok: false, error: "The amount is a whole number of EGP above zero" };
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv || inv.status === "void") return { ok: false as const, error: "Invoice not found" };
    const m = await money(tx, invoiceId);
    if (p.amountEgp > m.owed) return { ok: false as const, error: `That is more than is owed (${m.owed.toLocaleString("en-US")} EGP)` };
    const date = p.date ?? new Date();
    const reference = p.reference?.trim().slice(0, 120) || inv.number;
    // take it off the expected rows, oldest first; a row paid in full becomes the received row itself
    let left = p.amountEgp;
    for (const row of m.expected) {
      if (!left) break;
      if (row.amountEgp <= left) {
        await tx.update(ledgerEntries).set({ status: "received", date, reference, updatedAt: new Date() }).where(eq(ledgerEntries.id, row.id));
        left -= row.amountEgp;
      } else {
        await tx.update(ledgerEntries).set({ amountEgp: row.amountEgp - left, updatedAt: new Date() }).where(eq(ledgerEntries.id, row.id));
        await tx.insert(ledgerEntries).values({ entry: `${inv.number} — ${inv.clientName} (part payment)`.slice(0, 200), amountEgp: left, date, section: "income", category: CLIENT_WORK, status: "received", fromTo: inv.clientName, reference, invoiceId, createdBy: userId });
        left = 0;
      }
    }
    await audit(tx, { userId, entity: "invoice", entityId: invoiceId, action: "payment", diff: { amountEgp: p.amountEgp } });
    return { ok: true as const, owed: m.owed - p.amountEgp };
  });
}

/** Cancel an invoice issued by mistake, before anything is paid on it. Its cases can be invoiced again. */
export async function voidInvoice(db: Db, invoiceId: number, reason: string, userId: number | null): Promise<{ ok: true } | Fail> {
  const why = reason.trim().slice(0, 300);
  if (!why) return { ok: false, error: "Give the reason" };
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv || inv.status === "void") return { ok: false as const, error: "Invoice not found or already void" };
    const m = await money(tx, invoiceId);
    if (m.paid) return { ok: false as const, error: "Something is already paid on this invoice; record a refund instead" };
    await tx.update(invoices).set({ status: "void", voidReason: why }).where(eq(invoices.id, invoiceId));
    await tx.update(ledgerEntries).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(ledgerEntries.invoiceId, invoiceId), eq(ledgerEntries.status, "expected")));
    await tx.update(productionCases).set({ status: "delivered", invoiceId: null, updatedAt: new Date() }).where(eq(productionCases.invoiceId, invoiceId));
    await audit(tx, { userId, entity: "invoice", entityId: invoiceId, action: "void" });
    return { ok: true as const };
  });
}

export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>[number];

export async function listInvoices(db: Db, f: { clientId?: number } = {}, now = new Date()) {
  const rows = await db
    .select({
      i: invoices,
      paid: sql<number>`(select coalesce(sum(l.amount_egp), 0) from ledger_entries l where l.invoice_id = ${invoices.id} and l.deleted_at is null and l.status = 'received')::int`,
      owed: sql<number>`(select coalesce(sum(l.amount_egp), 0) from ledger_entries l where l.invoice_id = ${invoices.id} and l.deleted_at is null and l.status = 'expected')::int`,
    })
    .from(invoices)
    .innerJoin(productionClients, eq(productionClients.id, invoices.clientId)) // the join keeps ${invoices.id} qualified in the subqueries
    .where(f.clientId ? eq(invoices.clientId, f.clientId) : undefined)
    .orderBy(desc(invoices.issuedAt), desc(invoices.id));
  return rows.map((r) => {
    const owed = Number(r.owed);
    return { ...r.i, paid: Number(r.paid), owed, overdue: r.i.status === "issued" && owed > 0 && r.i.dueAt < now };
  });
}

/** One invoice with its client and payments, for its page and the printable copy. */
export async function getInvoice(db: Db, id: number) {
  const [r] = await db.select({ i: invoices, client: productionClients }).from(invoices).innerJoin(productionClients, eq(productionClients.id, invoices.clientId)).where(eq(invoices.id, id));
  if (!r) return null;
  const m = await money(db, id);
  return { ...r.i, client: r.client, payments: m.payments, paid: m.paid, owed: m.owed };
}
