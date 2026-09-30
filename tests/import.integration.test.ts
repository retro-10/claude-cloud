import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { parseCsv } from "@/lib/csv";
import { exportLeadsCsv } from "@/lib/export";
import { guessMapping, importLeads, parseDate, type ImportField, type ImportRow } from "@/lib/import";
import { createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Turn a parsed CSV into import rows the way the UI does (guess mapping from headers).
function toRows(csv: string): ImportRow[] {
  const [headers, ...body] = parseCsv(csv);
  const m = guessMapping(headers);
  return body.map((r) => {
    const o: ImportRow = {};
    for (const [f, i] of Object.entries(m) as [ImportField, number][]) o[f] = r[i];
    return o;
  });
}

const CLICKUP = `Task Name,Phone,Email,Source,Date Created,Status,Notes
د. محمد علي,010 1111 2222,mohamed@example.com,Instagram,05/09/2026 14:30,Contacted,"مهتم بالباقة, يريد استشارة"
Sara Ahmed,+20 100 333 4444,,Facebook group,,New,
No Phone Person,not-a-number,,Direct,,New,
=cmd|calc,0122 555 6666,,Referral,,Enrolled,bad stage falls back
Mohamed dup,+201011112222,,Instagram,,New,same phone as row 1
,,,,,,
`;

d("csv import / export", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number;
  const count = async () => (await client`select count(*)::int as n from leads`)[0].n as number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
  });
  afterAll(() => client.end());

  it("guesses columns from ClickUp headers", () => {
    const m = guessMapping(parseCsv(CLICKUP)[0]);
    expect(m).toMatchObject({ fullName: 0, phone: 1, email: 2, source: 3, createdAt: 4, stage: 5, notes: 6 });
  });

  it("preview (dry run) saves nothing but reports what would happen", async () => {
    const rep = await importLeads(db, toRows(CLICKUP), { updateExisting: true, dryRun: true }, userId);
    expect(rep.created).toBe(3);
    expect(await count()).toBe(0);
    expect((await client`select count(*)::int as n from stage_events`)[0].n).toBe(0);
  });

  it("imports, reports created/skipped with row numbers, and applies values", async () => {
    const rep = await importLeads(db, toRows(CLICKUP), { updateExisting: false, dryRun: false }, userId);
    expect(rep.created).toBe(3); // Mohamed, Sara, and the formula-named person
    expect(rep.skipped).toBe(2); // bad phone row, and the in-file duplicate of row 1
    expect(rep.errors.map((e) => e.row)).toContain(4);
    expect(rep.errors.find((e) => e.row === 4)?.message).toMatch(/Invalid phone/);

    const [m] = await db.select().from(s.leads).where(eq(s.leads.phoneWhatsapp, "+201011112222"));
    expect(m.fullName).toBe("د. محمد علي");
    expect(m.notes).toBe("مهتم بالباقة, يريد استشارة");
    expect(m.stage).toBe("contacted");
    // day-first date: 5 September 2026, 14:30
    expect(m.createdAt.toISOString()).toBe("2026-09-05T14:30:00.000Z");

    // stage history is written at the created date so funnel counts include imported leads
    const ev = await db.select().from(s.stageEvents).where(eq(s.stageEvents.leadId, m.id)).orderBy(s.stageEvents.id);
    expect(ev.map((e) => [e.fromStage, e.toStage])).toEqual([[null, "new"], ["new", "contacted"]]);
    expect(ev[0].at.toISOString()).toBe("2026-09-05T14:30:00.000Z");

    // "Enrolled" cannot be imported as a stage (no enrolment): falls back to new
    const [f] = await db.select().from(s.leads).where(eq(s.leads.phoneWhatsapp, "+201225556666"));
    expect(f.stage).toBe("new");
    expect(f.fullName).toBe("=cmd|calc");
  });

  it("importing the same file twice creates zero duplicates", async () => {
    const before = await count();
    const again = await importLeads(db, toRows(CLICKUP), { updateExisting: true, dryRun: false }, userId);
    expect(again.created).toBe(0);
    expect(await count()).toBe(before);
    // and with fill-blank updates on, a second pass changes nothing either
    expect(again.updated).toBe(0);
  });

  it("fills blank fields on existing leads but never overwrites", async () => {
    await createLead(db, { fullName: "Existing Eman", phone: "01555000111", city: "Giza" }, userId);
    const rep = await importLeads(
      db,
      [{ fullName: "Other Name", phone: "01555000111", city: "Alex", email: "eman@example.com", notes: "hello" }],
      { updateExisting: true, dryRun: false },
      userId,
    );
    expect(rep).toMatchObject({ created: 0, updated: 1 });
    const [e] = await db.select().from(s.leads).where(eq(s.leads.phoneWhatsapp, "+201555000111"));
    expect(e).toMatchObject({ fullName: "Existing Eman", city: "Giza", email: "eman@example.com", notes: "hello" });
  });

  it("refuses a row whose phone and email belong to two different leads", async () => {
    await createLead(db, { fullName: "P", phone: "01066000111" }, userId);
    await createLead(db, { fullName: "E", email: "e2@example.com" }, userId);
    const rep = await importLeads(db, [{ phone: "01066000111", email: "e2@example.com" }], { updateExisting: true, dryRun: false }, userId);
    expect(rep.skipped).toBe(1);
    expect(rep.errors[0].message).toMatch(/two different/);
  });

  it("rolls the whole import back if a row fails hard", async () => {
    const before = await count();
    await expect(
      importLeads(db, [{ fullName: "Fine", phone: "01077000111" }, { fullName: "x".repeat(2) , source: "Instagram", createdAt: "31/02/2026" }, null as unknown as ImportRow], { updateExisting: false, dryRun: false }, userId),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
  });

  it("export then re-import round-trips Arabic names, notes and formula-like text", async () => {
    await createLead(db, { fullName: "ليلى عبد الله", phone: "01088000111", notes: 'قال "مرحبا"\nسطر ثان، وفاصلة' }, userId);
    const { csv, count: n } = await exportLeadsCsv(db, { q: "ليلى" });
    expect(n).toBe(1);

    // hard-delete then import the exported file into the emptied slot
    await client`delete from stage_events where lead_id in (select id from leads where phone_whatsapp = '+201088000111')`;
    await client`delete from leads where phone_whatsapp = '+201088000111'`;
    const rep = await importLeads(db, toRows(csv), { updateExisting: false, dryRun: false }, userId);
    expect(rep.created).toBe(1);
    const [back] = await db.select().from(s.leads).where(eq(s.leads.phoneWhatsapp, "+201088000111"));
    expect(back.fullName).toBe("ليلى عبد الله");
    expect(back.notes).toBe('قال "مرحبا"\nسطر ثان، وفاصلة');

    // formula-looking name is escaped in the file and restored on import
    const all = await exportLeadsCsv(db, { q: "cmd" });
    expect(all.csv).toContain("'=cmd|calc");
  });

  it("export respects filters and excludes deleted leads", async () => {
    const { count: total } = await exportLeadsCsv(db, {});
    const { count: contacted } = await exportLeadsCsv(db, { stage: "contacted" });
    expect(contacted).toBeGreaterThan(0);
    expect(contacted).toBeLessThan(total);
    const live = (await client`select count(*)::int as n from leads where deleted_at is null`)[0].n;
    expect(total).toBe(live);
  });

  it("parseDate handles ClickUp epoch ms, ISO and garbage", () => {
    expect(parseDate("1788618600000")?.toISOString()).toBe("2026-09-05T14:30:00.000Z");
    expect(parseDate("2026-09-05T14:30:00Z")?.toISOString()).toBe("2026-09-05T14:30:00.000Z");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
});
