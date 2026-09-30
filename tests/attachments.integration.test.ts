import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { MAX_FILE_BYTES, addAttachment, cleanName, deleteAttachment, getAttachment, listAttachments } from "@/lib/attachments";
import { createCohort } from "@/lib/cohorts";
import { createLead } from "@/lib/leads";
import { mergeLeads } from "@/lib/merge";
import { withoutRelease11Rules } from "./base-rules";

describe("file names", () => {
  it("drop paths and control characters, keep the end of long names", () => {
    expect(cleanName("C:\\Users\\me\\receipt.pdf")).toBe("receipt.pdf");
    expect(cleanName("../../etc/passwd")).toBe("passwd");
    expect(cleanName('bad"\u0000name.png')).toBe("badname.png");
    expect(cleanName("x".repeat(200) + ".stl")).toHaveLength(120);
    expect(cleanName("شهادة.pdf")).toBe("شهادة.pdf");
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("files on leads and batches", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let owner: number, sales: number, leadId: number, cohortId: number;
  const pdf = Buffer.from("%PDF-1.4 receipt");

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    const u = await db.select().from(s.users);
    owner = u.find((x) => x.email === "retro@orladent.local")!.id;
    sales = u.find((x) => x.role === "finance")!.id; // any non-owner
    const l = await createLead(db, { fullName: "File Lead", phone: "01033330000" }, owner);
    if (!l.ok) throw new Error("setup");
    leadId = l.lead.id;
    cohortId = (await createCohort(db, { name: "Batch F", seatCap: 10 }, owner)).id;
  });
  afterAll(() => client.end());

  it("accepts documents and case files; refuses programs, web pages, empty and oversized files, and files on nothing", async () => {
    expect(await addAttachment(db, { name: "receipt.pdf", bytes: pdf }, { leadId }, sales)).toMatchObject({ ok: true });
    expect(await addAttachment(db, { name: "crown.STL", bytes: Buffer.from("solid x") }, { leadId, note: "case 12" }, sales)).toMatchObject({ ok: true });
    expect(await addAttachment(db, { name: "plan.xlsx", bytes: Buffer.from("PK") }, { cohortId }, owner)).toMatchObject({ ok: true });
    for (const name of ["run.exe", "page.html", "logo.svg", "noext"]) expect((await addAttachment(db, { name, bytes: pdf }, { leadId }, owner)).ok, name).toBe(false);
    expect(await addAttachment(db, { name: "a.pdf", bytes: Buffer.alloc(0) }, { leadId }, owner)).toEqual({ ok: false, error: "The file is empty" });
    expect((await addAttachment(db, { name: "a.pdf", bytes: Buffer.alloc(MAX_FILE_BYTES + 1) }, { leadId }, owner)).ok).toBe(false);
    expect(await addAttachment(db, { name: "a.pdf", bytes: pdf }, {}, owner)).toEqual({ ok: false, error: "Attach the file to a lead or a batch" });
    expect(await addAttachment(db, { name: "a.pdf", bytes: pdf }, { leadId, cohortId }, owner)).toEqual({ ok: false, error: "Attach the file to a lead or a batch" });

    const list = await listAttachments(db, { leadId });
    expect(list.map((f) => [f.fileName, f.contentType, f.size])).toEqual([
      ["crown.STL", "model/stl", 7],
      ["receipt.pdf", "application/pdf", pdf.length],
    ]);
    expect(list[0]).not.toHaveProperty("data"); // lists never carry the bytes
    expect((await getAttachment(db, list[1].id))!.data.equals(pdf)).toBe(true);
    expect((await listAttachments(db, { cohortId })).map((f) => f.fileName)).toEqual(["plan.xlsx"]);
  });

  it("only the uploader or an owner deletes; deleting removes the bytes", async () => {
    const [plan] = await listAttachments(db, { cohortId }); // uploaded by the owner
    expect(await deleteAttachment(db, plan.id, { id: sales, isOwner: false })).toMatchObject({ ok: false });
    const [crown] = await listAttachments(db, { leadId }); // uploaded by finance
    expect(await deleteAttachment(db, crown.id, { id: sales, isOwner: false })).toEqual({ ok: true });
    expect(await deleteAttachment(db, plan.id, { id: owner, isOwner: true })).toEqual({ ok: true });
    expect(await getAttachment(db, crown.id)).toBeNull();
    const [row] = await db.select().from(s.attachments).where(eq(s.attachments.id, crown.id));
    expect(row.data.length).toBe(0);
    expect(await listAttachments(db, { cohortId })).toHaveLength(0);
  });

  it("a lead's files move with it in a merge", async () => {
    const twin = await createLead(db, { fullName: "File Lead 2", phone: "01033330001" }, owner);
    if (!twin.ok) throw new Error("setup");
    await addAttachment(db, { name: "id.png", bytes: Buffer.from("png") }, { leadId: twin.lead.id }, owner);
    const m = await mergeLeads(db, { survivorId: leadId, loserId: twin.lead.id, pick: {} }, owner);
    if (!m.ok) throw new Error(m.error);
    expect((await listAttachments(db, { leadId })).map((f) => f.fileName)).toContain("id.png");
  });
});
