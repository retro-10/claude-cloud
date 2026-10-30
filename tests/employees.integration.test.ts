import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import {
  acknowledgeDocument,
  addDocument,
  changeRequests,
  decideChange,
  documentsFor,
  getDocument,
  getEmployee,
  listEmployees,
  myPay,
  newDocumentVersion,
  requestChange,
  saveEmployee,
  updateContact,
} from "@/lib/employees";
import { saveEntry } from "@/lib/finance";
import { createUser } from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const pdf = (name = "contract.pdf") => ({ name, bytes: Buffer.from("%PDF-1.4 test") });

d("the employee portal", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  type P = { id: number; name: string };
  let retro: P, badr: P, karim: P;

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
    badr = await get("badr@orladent.local");
    const k = await createUser(db, { name: "Karim", email: "karim@ep.local", role: "sales", password: "long enough pw" }, null);
    if (!k.ok) throw new Error("user");
    karim = { id: k.id, name: "Karim" };
  });
  afterAll(() => client.end());

  it("a person without a record sees a blank one; they keep their own contact details", async () => {
    expect(await getEmployee(db, karim.id)).toMatchObject({ exists: false, workerType: "employee", phone: null, user: { name: "Karim", role: "sales" } });
    expect(await updateContact(db, karim.id, { personalEmail: "not an email" })).toMatchObject({ ok: false });
    expect(await updateContact(db, karim.id, { phone: " 0100 000 0000 ", emergencyName: "Mona", payTerms: "a fortune" } as never)).toEqual({ ok: true });
    const e = await getEmployee(db, karim.id);
    expect(e).toMatchObject({ exists: true, phone: "0100 000 0000", emergencyName: "Mona", payTerms: null }); // pay is not a contact field
    // the audit says which fields, never their values
    const [log] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, "employee"), eq(s.auditLog.action, "contact")));
    expect(JSON.stringify(log.diff)).not.toContain("0100");
  });

  it("an owner fills in the terms; validation; the manager is someone else", async () => {
    expect(await saveEmployee(db, retro.id, karim.id, { workerType: "astronaut" })).toMatchObject({ ok: false });
    expect(await saveEmployee(db, retro.id, karim.id, { workerType: "employee", startDate: "2026-02-30x" })).toMatchObject({ ok: false });
    expect(await saveEmployee(db, retro.id, karim.id, { workerType: "employee", managerId: karim.id })).toMatchObject({ ok: false });
    expect(
      await saveEmployee(db, retro.id, karim.id, { workerType: "employee", jobTitle: "Sales lead", startDate: "2026-01-04", managerId: badr.id, payTerms: "Monthly salary", payAmountEgp: 15_000, paySchedule: "Month end" }),
    ).toEqual({ ok: true });
    expect(await getEmployee(db, karim.id)).toMatchObject({ jobTitle: "Sales lead", manager: badr.name, payAmountEgp: 15_000, phone: "0100 000 0000" }); // contact kept
  });

  it("finance's list has pay terms only: no contact, dates, manager or titles", async () => {
    const pay = (await listEmployees(db, "pay")).find((r) => r.id === karim.id)!;
    expect(pay).toMatchObject({ payTerms: "Monthly salary", payAmountEgp: 15_000, paySchedule: "Month end" });
    expect(Object.keys(pay).sort()).toEqual(["active", "id", "name", "payAmountEgp", "paySchedule", "payTerms", "role", "workerType"]);
    expect((await listEmployees(db, "full")).find((r) => r.id === karim.id)).toMatchObject({ jobTitle: "Sales lead", startDate: "2026-01-04" });
  });

  it("sensitive changes are asked for, go to the owners, and an owner applies or declines them (never their own)", async () => {
    expect(await requestChange(db, karim, "payAmountEgp", "")).toMatchObject({ ok: false });
    expect(await requestChange(db, karim, "phone", "x")).toMatchObject({ ok: false }); // contact: edit it yourself
    expect(await requestChange(db, karim, "payAmountEgp", "18,000", "New scope")).toEqual({ ok: true });
    expect(await requestChange(db, karim, "payAmountEgp", "19000")).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.kind, "employee_change"));
    expect(notes.map((n) => n.userId).sort()).toEqual([retro.id, badr.id].sort());
    const [{ r }] = await changeRequests(db, { userId: karim.id, pending: true });
    expect(await decideChange(db, retro, r.id, false)).toMatchObject({ ok: false, error: expect.stringContaining("why") });
    expect(await decideChange(db, retro, r.id, true)).toEqual({ ok: true });
    expect((await getEmployee(db, karim.id))!.payAmountEgp).toBe(18_000);
    expect(await decideChange(db, retro, r.id, true)).toMatchObject({ ok: false });
    // an owner's own request is decided by another owner
    await requestChange(db, retro, "jobTitle", "CEO");
    const [{ r: own }] = await changeRequests(db, { userId: retro.id, pending: true });
    expect(await decideChange(db, retro, own.id, true)).toMatchObject({ ok: false, error: expect.stringContaining("Another owner") });
    expect(await decideChange(db, badr, own.id, true)).toEqual({ ok: true });
    expect((await getEmployee(db, retro.id))!.jobTitle).toBe("CEO");
  });

  it("documents: added with a file, the person is asked; accepted once; a new version keeps the old one", async () => {
    expect(await addDocument(db, retro.id, karim.id, { category: "contract", title: "Contract" }, null)).toMatchObject({ ok: false });
    expect(await addDocument(db, retro.id, karim.id, { category: "contract", title: "Contract" }, { name: "x.exe", bytes: Buffer.from("x") })).toMatchObject({ ok: false });
    expect(await db.select().from(s.employeeDocuments)).toEqual([]); // nothing left behind by a refused file
    const c = await addDocument(db, retro.id, karim.id, { category: "contract", title: "Employment contract" }, pdf());
    if (!c.ok) throw new Error(c.error);
    const [note] = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, karim.id), eq(s.notifications.kind, "employee_document")));
    expect(note).toMatchObject({ title: "Please read and accept: Employment contract", link: `/me/documents/${c.id}` });

    expect(await acknowledgeDocument(db, badr.id, c.id)).toMatchObject({ ok: false }); // not hers
    expect(await acknowledgeDocument(db, karim.id, c.id)).toEqual({ ok: true });
    expect(await acknowledgeDocument(db, karim.id, c.id)).toMatchObject({ ok: false });

    const v2 = await newDocumentVersion(db, retro.id, c.id, pdf("contract-v2.pdf"));
    if (!v2.ok) throw new Error(v2.error);
    const docs = await documentsFor(db, karim.id);
    expect(docs.map((x) => [x.version, x.status, !!x.acknowledgedAt, !!x.fileId])).toEqual([
      [2, "current", false, true],
      [1, "superseded", true, true],
    ]);
    expect(await newDocumentVersion(db, retro.id, c.id, pdf())).toMatchObject({ ok: false, error: expect.stringContaining("current") });
    expect(await acknowledgeDocument(db, karim.id, c.id)).toMatchObject({ ok: false }); // the replaced one cannot be accepted
  });

  it("a document opens for its person and for owners, not for anyone else", async () => {
    const [doc] = await documentsFor(db, karim.id);
    expect(await getDocument(db, doc.id, { id: karim.id, role: "sales", manage: false })).toMatchObject({ title: "Employment contract", file: { fileName: "contract-v2.pdf" } });
    expect((await getDocument(db, doc.id, { id: karim.id, role: "sales", manage: false }))!.history.map((h) => h.version)).toEqual([2, 1]);
    expect(await getDocument(db, doc.id, { id: badr.id, role: "owner", manage: true })).not.toBeNull();
    const other = await createUser(db, { name: "Farida", email: "farida@ep.local", role: "finance", password: "long enough pw" }, null);
    if (!other.ok) throw new Error("user");
    expect(await getDocument(db, doc.id, { id: other.id, role: "finance", manage: false })).toBeNull();
  });

  it("my pay: nothing until the record is linked to a team member, then their cost rows", async () => {
    expect(await myPay(db, karim.id)).toBeNull();
    const [tm] = await db.insert(s.teamMembers).values({ name: "Karim" }).returning();
    await saveEntry(db, null, { entry: "October salary", amountEgp: 18_000, section: "fixed_costs", category: "Salaries", status: "paid", teamMemberId: tm.id }, retro.id);
    await saveEntry(db, null, { entry: "Someone else", amountEgp: 9_000, section: "fixed_costs", category: "Salaries", status: "paid" }, retro.id);
    await saveEmployee(db, retro.id, karim.id, { ...(await getEmployee(db, karim.id))!, teamMemberId: tm.id });
    expect((await myPay(db, karim.id))!.map((p) => [p.entry, p.amountEgp])).toEqual([["October salary", 18_000]]);
  });
});
