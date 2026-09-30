import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { leads, sources, stageEvents, stages } from "@/db/schema";
import { audit } from "./audit";
import { unsafeCell } from "./csv";
import { findDuplicates } from "./leads";
import { normalizePhone } from "./phone";

import {
  IMPORT_FIELDS,
  SEGMENTS,
  TIERS,
  parseDate,
  pick,
  type ImportField,
  type ImportRow,
} from "./import-fields";

export * from "./import-fields";

export type ImportReport = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  warnings: number;
};

class DryRunRollback extends Error {}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function importLeads(
  db: Db,
  rows: ImportRow[],
  opts: { updateExisting: boolean; dryRun: boolean },
  userId: number | null,
): Promise<ImportReport> {
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [], warnings: 0 };
  const err = (i: number, message: string) => {
    report.skipped++;
    report.errors.push({ row: i + 2, message }); // +2: header is row 1
  };

  try {
    await db.transaction(async (tx) => {
      const srcMap = new Map((await tx.select().from(sources)).map((s) => [s.label.toLowerCase(), s.id]));
      const stageList = await tx.select().from(stages);
      const stageByName = new Map<string, string>();
      for (const s of stageList)
        if (s.kind === "open" || s.kind === "nurture") {
          stageByName.set(s.key.toLowerCase(), s.key);
          stageByName.set(s.label.toLowerCase(), s.key);
        }

      for (const [i, raw] of rows.entries()) {
        const clean = (k: ImportField) => {
          const v = raw[k] === undefined ? "" : unsafeCell(String(raw[k]).trim());
          return v === "" ? null : v;
        };
        const phoneRaw = clean("phone");
        const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
        const emailRaw = clean("email")?.toLowerCase() ?? null;
        const email = emailRaw && EMAIL.test(emailRaw) ? emailRaw : null;
        if (emailRaw && !email) report.warnings++;
        if (phoneRaw && !phone && !email) {
          err(i, `Invalid phone number "${phoneRaw}"`);
          continue;
        }
        if (phoneRaw && !phone) report.warnings++;
        const fullName = clean("fullName") ?? phone ?? email;
        if (!fullName) {
          err(i, "No name, phone or email");
          continue;
        }

        const source = clean("source");
        const sourceId = source ? (srcMap.get(source.toLowerCase()) ?? null) : null;
        if (source && !sourceId) report.warnings++; // unknown source label: left blank
        const segment = pick(SEGMENTS, clean("segment") ?? undefined);
        const tier = pick(TIERS, clean("tierInterest") ?? undefined);
        const stageRaw = clean("stage");
        const stage = stageRaw ? stageByName.get(stageRaw.toLowerCase()) : undefined;
        if (stageRaw && !stage) report.warnings++; // unknown or won/lost stage: falls back to new
        const createdRaw = clean("createdAt");
        const createdAt = parseDate(createdRaw ?? undefined);
        if (createdRaw && !createdAt) report.warnings++;

        const dupes = await findDuplicates(tx, { phone, email });
        const ids = [...new Set(dupes.map((d) => d.id))];
        if (ids.length > 1) {
          err(i, "Phone and email match two different existing leads");
          continue;
        }

        if (ids.length === 1) {
          const existing = dupes[0];
          if (existing.deleted) {
            err(i, `Matches deleted lead "${existing.fullName}" (restore it instead)`);
            continue;
          }
          if (!opts.updateExisting) {
            report.skipped++;
            continue;
          }
          const [cur] = await tx.select().from(leads).where(eq(leads.id, existing.id));
          // fill blanks only; never overwrite what is already there
          const set: Partial<typeof leads.$inferInsert> = {};
          if (!cur.phoneWhatsapp && phone) set.phoneWhatsapp = phone;
          if (!cur.email && email) set.email = email;
          if (!cur.city && clean("city")) set.city = clean("city");
          if (!cur.segment && segment) set.segment = segment;
          if (!cur.sourceId && sourceId) set.sourceId = sourceId;
          if (cur.tierInterest === "unsure" && tier && tier !== "unsure") set.tierInterest = tier;
          if (!cur.notes && clean("notes")) set.notes = clean("notes");
          if (Object.keys(set).length) {
            await tx.update(leads).set({ ...set, updatedAt: new Date() }).where(eq(leads.id, cur.id));
            report.updated++;
          } else report.skipped++;
          continue;
        }

        const at = createdAt ?? new Date();
        const [lead] = await tx
          .insert(leads)
          .values({
            fullName,
            phoneWhatsapp: phone,
            phoneRaw,
            email,
            city: clean("city"),
            segment,
            sourceId,
            tierInterest: tier ?? "unsure",
            notes: clean("notes"),
            ownerId: userId,
            stage: stage ?? "new",
            createdAt: at,
          })
          .returning();
        // funnel history: created as new, then moved to the imported stage, both at the created date
        await tx.insert(stageEvents).values({ leadId: lead.id, fromStage: null, toStage: "new", at, byUserId: userId });
        if (lead.stage !== "new")
          await tx.insert(stageEvents).values({ leadId: lead.id, fromStage: "new", toStage: lead.stage, at, byUserId: userId });
        report.created++;
      }

      if (opts.dryRun) throw new DryRunRollback();
      await audit(tx, {
        userId,
        entity: "lead",
        action: "import",
        diff: { created: report.created, updated: report.updated, skipped: report.skipped },
      });
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}
