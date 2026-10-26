import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { addAttachment } from "@/lib/attachments";
import { createUser } from "@/lib/settings";
import {
  DEFAULT_QC,
  assignCase,
  canWorkOnCase,
  cancelCase,
  createCase,
  deliverCase,
  designerStats,
  getCase,
  listCases,
  listClients,
  parseChecklist,
  productionPulse,
  reviewQc,
  saveCaseType,
  saveClient,
  sendToQc,
  startCase,
} from "@/lib/production";
import { addWorkingDays, quote } from "@/lib/production-quote";
import { cairoLocalToDate } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("turnaround quote (pure)", () => {
  it("counts working days, skipping Fridays", () => {
    expect(addWorkingDays("2026-10-01", 1)).toBe("2026-10-03"); // Thursday + 1 → Saturday
    expect(addWorkingDays("2026-10-01", 2)).toBe("2026-10-04");
    expect(addWorkingDays("2026-10-02", 1)).toBe("2026-10-03"); // received on the Friday
    expect(addWorkingDays("2026-10-01", 0)).toBe("2026-10-01");
  });
  it("prices units, rush and the client's discount in whole EGP", () => {
    const base = { unitPriceEgp: 900, standardDays: 2, rushDays: 1, rushSurchargePct: 50, receivedYmd: "2026-10-01" };
    expect(quote({ ...base, units: 2, rush: false, discountPct: 0 })).toMatchObject({ priceEgp: 1800, listEgp: 1800, surchargeEgp: 0, discountEgp: 0, days: 2, dueYmd: "2026-10-04" });
    expect(quote({ ...base, units: 2, rush: true, discountPct: 10 })).toMatchObject({ priceEgp: 2430, listEgp: 1800, surchargeEgp: 900, discountEgp: 270, days: 1, dueYmd: "2026-10-03" });
  });
  it("reads a checklist one item per line", () => {
    expect(parseChecklist("- Fit\n\n• Margins\nFit")).toEqual(["Fit", "Margins"]);
    expect(parseChecklist(Array.from({ length: 16 }, (_, i) => `x${i}`).join("\n"))).toMatch(/15/);
  });
});

d("production studio", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, owner2: number, designer: number, other: number, clinic: number, crown: number;
  const as = (id: number, role: "owner" | "designer" | "finance") => ({ id, role });

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    const us = await db.select().from(s.users);
    owner = us.find((u) => u.role === "owner")!.id;
    owner2 = us.filter((u) => u.role === "owner")[1].id;
    const mk = async (name: string) => {
      const r = await createUser(db, { name, email: `${name}@x.local`, role: "designer", password: "long enough pw" }, null);
      if (!r.ok) throw new Error(r.error);
      return (await db.select().from(s.users).where(eq(s.users.email, `${name}@x.local`)))[0].id;
    };
    designer = await mk("dana");
    other = await mk("omar");
  });
  afterAll(() => client.end());

  it("clients and the price list are checked", async () => {
    expect(await saveClient(db, null, { name: " ", kind: "clinic", discountPct: 0, paymentTermsDays: 14 }, owner)).toMatchObject({ ok: false });
    expect(await saveClient(db, null, { name: "Smile", kind: "clinic", discountPct: 80, paymentTermsDays: 14 }, owner)).toMatchObject({ ok: false });
    expect(await saveClient(db, null, { name: "Smile", kind: "clinic", phone: "not a phone", discountPct: 0, paymentTermsDays: 14 }, owner)).toMatchObject({ ok: false });
    const c = await saveClient(db, null, { name: "Smile Clinic", kind: "clinic", phone: "0100 000 0001", discountPct: 10, paymentTermsDays: 14 }, owner);
    if (!c.ok) throw new Error(c.error);
    clinic = c.id;
    expect((await db.select().from(s.productionClients).where(eq(s.productionClients.id, clinic)))[0].phone).toBe("+201000000001");
    const t = { name: "Crown", unitPriceEgp: 900, designerPayEgp: 350, standardDays: 2, rushDays: 1, rushSurchargePct: 50, qcChecklist: [] };
    expect(await saveCaseType(db, null, { ...t, designerPayEgp: 1000 }, owner)).toMatchObject({ ok: false });
    expect(await saveCaseType(db, null, { ...t, rushDays: 3 }, owner)).toMatchObject({ ok: false });
    const r = await saveCaseType(db, null, t, owner);
    if (!r.ok) throw new Error(r.error);
    crown = r.id;
    expect(await saveCaseType(db, null, t, owner)).toEqual({ ok: false, error: "There is already a case type with that name" });
  });

  it("intake fixes the price and due date from the price list and the client's discount", async () => {
    const received = cairoLocalToDate("2026-10-01T10:00")!; // a Thursday
    const r = await createCase(db, { clientId: clinic, caseTypeId: crown, units: 2, rush: true, receivedAt: received }, owner);
    if (!r.ok) throw new Error(r.error);
    expect(r.priceEgp).toBe(2430);
    expect(r.dueAt.toISOString()).toBe(cairoLocalToDate("2026-10-03T18:00")!.toISOString());
    const [row] = await db.select().from(s.productionCases).where(eq(s.productionCases.id, r.id));
    expect(row).toMatchObject({ status: "received", designerPayEgp: 700, designerId: null });
    expect(await createCase(db, { clientId: clinic, caseTypeId: crown, units: 0, rush: false }, owner)).toMatchObject({ ok: false });
    expect(await createCase(db, { clientId: clinic, caseTypeId: crown, units: 1, rush: false, designerId: owner2 }, owner)).toMatchObject({ ok: true });
  });

  it("runs a case: assign, start, files, QC by someone else, sent back, passed, delivered with the designer's pay owed", async () => {
    const r = await createCase(db, { clientId: clinic, caseTypeId: crown, units: 1, rush: false, reference: "job 7" }, owner);
    if (!r.ok) throw new Error(r.error);
    const id = r.id;
    expect(await assignCase(db, id, designer, owner)).toEqual({ ok: true });
    // only the assigned designer (or a manager) works it
    expect(await startCase(db, id, as(other, "designer"))).toMatchObject({ ok: false });
    expect(await startCase(db, id, as(designer, "designer"))).toEqual({ ok: true });
    expect(await canWorkOnCase(db, id, as(designer, "designer"))).toBe(true);
    expect(await canWorkOnCase(db, id, as(other, "designer"))).toBe(false);
    expect(await sendToQc(db, id, as(designer, "designer"))).toEqual({ ok: false, error: "Add the design files to the case first" });
    const f = await addAttachment(db, { name: "crown.stl", bytes: Buffer.from("solid x") }, { caseId: id }, designer);
    expect(f.ok).toBe(true);
    expect(await sendToQc(db, id, as(designer, "designer"))).toEqual({ ok: true });
    expect(await canWorkOnCase(db, id, as(designer, "designer"))).toBe(false); // files are frozen in QC
    // the designer cannot check their own work; every item must be answered; a fail needs a note
    expect(await reviewQc(db, id, DEFAULT_QC.map(() => true), null, designer)).toMatchObject({ ok: false });
    expect(await reviewQc(db, id, [true], null, owner)).toMatchObject({ ok: false });
    expect(await reviewQc(db, id, [true, false, true, true], null, owner)).toEqual({ ok: false, error: "Say what to fix" });
    expect(await reviewQc(db, id, [true, false, true, true], "Open the distal margin", owner)).toEqual({ ok: true, passed: false });
    let c = (await getCase(db, id, as(designer, "designer")))!;
    expect(c).toMatchObject({ status: "designing", qcFails: 1, qcNote: "Open the distal margin" });
    expect(await deliverCase(db, id, owner)).toMatchObject({ ok: false });
    await sendToQc(db, id, as(designer, "designer"));
    expect(await reviewQc(db, id, DEFAULT_QC.map(() => true), null, owner)).toEqual({ ok: true, passed: true });
    expect(await deliverCase(db, id, owner)).toEqual({ ok: true });
    c = (await getCase(db, id, as(owner, "owner")))!;
    expect(c.status).toBe("delivered");
    const pay = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.caseId, id));
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ section: "variable_costs", category: "Production designers", status: "owed", amountEgp: 350, fromTo: "dana" });
    expect(await cancelCase(db, id, "too late", owner)).toMatchObject({ ok: false });
  });

  it("designers see only their own cases; managers and finance see all", async () => {
    const mine = await listCases(db, as(designer, "designer"));
    expect(mine.length).toBe(1);
    expect(mine.every((c) => c.designerId === designer)).toBe(true);
    expect((await listCases(db, as(other, "designer"))).length).toBe(0);
    const all = await listCases(db, as(owner, "finance"));
    expect(all.length).toBe(3);
    const someone = all.find((c) => c.designerId !== designer)!;
    expect(await getCase(db, someone.id, as(designer, "designer"))).toBeNull();
  });

  it("cancels an open case with a reason; counts the pulse and each designer's figures", async () => {
    const open = (await listCases(db, as(owner, "owner"), { status: ["received"] }))[0];
    expect(await cancelCase(db, open.id, " ", owner)).toMatchObject({ ok: false });
    expect(await cancelCase(db, open.id, "Client withdrew it", owner)).toEqual({ ok: true });
    const p = await productionPulse(db, cairoLocalToDate("2026-12-01T00:00")!);
    expect(p).toMatchObject({ open: 1, late: 1, qc: 0, unassigned: 0, toInvoice: 1 });
    // a second client with nothing, so the per-client counts must not mix clients up
    await saveClient(db, null, { name: "Quiet Lab", kind: "lab", discountPct: 0, paymentTermsDays: 30 }, owner);
    const clients = await listClients(db);
    expect(clients.find((c) => c.name === "Smile Clinic")).toMatchObject({ open: 1, toInvoice: 1, owed: 0 });
    expect(clients.find((c) => c.name === "Quiet Lab")).toMatchObject({ open: 0, toInvoice: 0, owed: 0 });
    const stats = await designerStats(db, new Date(Date.now() - 90 * 86_400_000));
    expect(stats.find((x) => x.id === designer)).toMatchObject({ open: 0, delivered: 1, firstPassRate: 0, pay: 350 });
    expect(stats.find((x) => x.id === owner2)).toMatchObject({ open: 1, delivered: 0, firstPassRate: null });
  });
});
