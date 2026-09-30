"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { IMPORT_FIELDS, importLeads, type ImportReport } from "@/lib/import";
import { requireCan } from "@/lib/server-auth";

const MAX_ROWS = 20_000;

const rowSchema = z.record(z.enum(IMPORT_FIELDS), z.string().max(10_000));
const inputSchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
  updateExisting: z.boolean(),
  dryRun: z.boolean(),
});

export type ImportResult = { ok: true; report: ImportReport; dryRun: boolean } | { ok: false; error: string };

export async function runImport(input: unknown): Promise<ImportResult> {
  const user = await requireCan("lead:write");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid import data (max ${MAX_ROWS} rows).` };
  const { rows, updateExisting, dryRun } = parsed.data;
  try {
    const report = await importLeads(db, rows, { updateExisting, dryRun }, user.id);
    // keep the report small: never echo lead data back, just row numbers and messages
    report.errors = report.errors.slice(0, 100);
    if (!dryRun) revalidatePath("/leads");
    return { ok: true, report, dryRun };
  } catch {
    return { ok: false, error: "Import failed and was rolled back. Nothing was saved." };
  }
}
