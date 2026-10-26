"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { saveSettings } from "@/lib/app-settings";
import { approvePay, closeCycle, recordLegacy, removeFunction, saveFunction, saveReview, undoPay } from "@/lib/cycle";
import type { FinanceModel, TierPrice } from "@/lib/finance-model";
import { can } from "@/lib/rbac";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";
import { importWorkbook, previewWorkbook, XlsxError, type WorkbookPreview } from "@/lib/workbook-import";

type R = { ok: true } | { ok: false; error: string };

function done(form: FormData, result: R, notice: string, fallback = "/finance") {
  const back = safePath(form.get("back"), fallback);
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  redirect(result.ok ? `${back}${sep}notice=${encodeURIComponent(notice)}` : `${back}${sep}error=${encodeURIComponent(result.error)}`);
}

const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? Number.NaN : Number(String(v).replace(/,/g, "")));
const all = (form: FormData, k: string) => form.getAll(k).map(String);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// ---------------- settings: the finance model, prices, decision rights ----------------

/** The whole finance model form. Rows left empty are dropped; everything is checked again in the settings layer. */
export async function saveFinanceModelAction(form: FormData) {
  const user = await requireCan("settings:write");
  const names = all(form, "shareName");
  const fixedLabels = all(form, "fixedLabel");
  const fixedAmounts = all(form, "fixedAmount");
  const fixedLow = all(form, "fixedLow");
  const fixedHigh = all(form, "fixedHigh");
  const fixedNote = all(form, "fixedNote");
  const pools = all(form, "tierPool").map((v) => num(v)).filter((v) => Number.isFinite(v));
  const balancing = String(form.get("balancing") ?? "");
  const model: FinanceModel = {
    closeDate: String(form.get("closeDate") ?? "").trim() || null,
    coreSplit: {
      partners: names.map((name, i) => ({ name, pct: num(all(form, "corePct")[i]) })).filter((p) => p.name.trim()),
      capitalPct: num(form.get("coreCapitalPct")),
    },
    newShares: names.map((name, i) => ({ name, pct: num(all(form, "newPct")[i]) })).filter((p) => p.name.trim()),
    retainPct: num(form.get("retainPct")),
    reserveMonths: num(form.get("reserveMonths")),
    fixedCosts: fixedLabels
      .map((label, i) => ({ label, amount: num(fixedAmounts[i]), low: Number.isFinite(num(fixedLow[i])) ? num(fixedLow[i]) : null, high: Number.isFinite(num(fixedHigh[i])) ? num(fixedHigh[i]) : null, note: fixedNote[i] ?? "" }))
      .filter((f) => f.label.trim()),
    tiers: pools.map((pool) => ({ pool })),
    triggerBuffer: num(form.get("triggerBuffer")),
    triggerRound: num(form.get("triggerRound")),
    monthsRunning: num(form.get("monthsRunning")),
    baseFraction: num(form.get("basePct")) / 100,
    kpiMax: num(form.get("kpiMax")),
    partners: names
      .map((name, i) => ({ name: name.trim(), role: all(form, "role")[i] ?? "", outcome: all(form, "outcome")[i] ?? "", multiplier: num(all(form, "multiplier")[i]), balancing: balancing === name.trim() }))
      .filter((p) => p.name),
    seatPrice: num(form.get("seatPrice")),
    exocadFeePerCase: num(form.get("exocadFeePerCase")),
    agentCommissionPct: num(form.get("agentCommissionPct")),
    withholdLegacy: form.get("withholdLegacy") === "on",
  };
  if (!model.partners.some((p) => p.balancing) && model.partners.length) model.partners[model.partners.length - 1].balancing = true;
  const r = await saveSettings(db, { financeModel: model }, user.id);
  done(form, r.ok ? r : { ok: false, error: "Check the numbers: the new shares must add up to 100%, the Core split with Capital too, and each tier above the last" }, "Finance model saved", "/settings/finance");
}

export async function savePricesAction(form: FormData) {
  const user = await requireCan("settings:write");
  const prices: TierPrice[] = (["foundation", "freelance_ready", "production_partner"] as const).map((key) => ({
    key,
    label: String(form.get(`${key}_label`) ?? ""),
    price: num(form.get(`${key}_price`)),
    offered: form.get(`${key}_offered`) === "on",
    payments: num(form.get(`${key}_payments`)),
  }));
  const r = await saveSettings(db, { prices }, user.id);
  done(form, r.ok ? r : { ok: false, error: "Each tier needs a name, a price and 1 to 24 payments" }, "Prices saved", "/settings/finance");
}

export async function saveDecisionRightsAction(form: FormData) {
  const user = await requireCan("settings:write");
  const who = all(form, "who");
  const decisionRights = all(form, "decision").map((decision, i) => ({ decision, who: who[i] ?? "" }));
  const r = await saveSettings(db, { decisionRights }, user.id);
  done(form, r.ok ? r : { ok: false, error: "Keep each line under 300 characters" }, "Decision rights saved", "/settings/finance");
}

// ---------------- importing the cycle close workbook ----------------

async function fileFrom(form: FormData) {
  const f = form.get("file");
  if (!(f instanceof File) || !f.size) throw new XlsxError("Choose the workbook (.xlsx)");
  if (f.size > 10 * 1024 * 1024) throw new XlsxError("The file is larger than 10 MB");
  return Buffer.from(await f.arrayBuffer());
}

/** Reads the workbook and returns what would be imported, without writing anything. */
export async function previewWorkbookAction(form: FormData): Promise<{ ok: true; preview: WorkbookPreview } | { ok: false; error: string }> {
  await requireCan("payment:write");
  try {
    return { ok: true, preview: await previewWorkbook(db, await fileFrom(form)) };
  } catch (e) {
    if (e instanceof XlsxError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function importWorkbookAction(form: FormData): Promise<{ ok: true; added: number; archived: number; skipped: number; functions: number } | { ok: false; error: string }> {
  const user = await requireCan("payment:write");
  // the model and the functions are the partners' rules: only owners may replace them
  const owner = can(user.role, "settings:write");
  try {
    const r = await importWorkbook(
      db,
      await fileFrom(form),
      {
        date: String(form.get("date") ?? ""),
        closeDate: owner ? String(form.get("closeDate") ?? "") || null : null,
        replaceLedger: form.get("replaceLedger") === "on",
        model: owner && form.get("model") === "on",
        functions: owner && form.get("functions") === "on",
      },
      user.id,
    );
    revalidatePath("/", "layout");
    return r;
  } catch (e) {
    if (e instanceof XlsxError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---------------- the cycle close and the legacy ledger ----------------

export async function closeCycleAction(form: FormData) {
  const user = await requireCan("settings:write");
  const r = await closeCycle(db, user.id);
  done(form, r, "The old cycle is closed: the legacy balances are open", "/finance/cycle");
}

export async function recordLegacyAction(form: FormData) {
  const user = await requireCan("payment:write");
  const p = z
    .object({ partner: z.string().max(40), kind: z.enum(["payment", "adjustment"]), amount: z.string().max(20), note: z.string().max(300).optional(), date: z.string().max(10).optional() })
    .parse(Object.fromEntries(form));
  const r = await recordLegacy(db, { partner: p.partner, kind: p.kind, amountEgp: Math.round(num(p.amount)), note: p.note, date: p.date }, user.id);
  done(form, r, p.kind === "payment" ? "Legacy payment recorded" : "Adjustment recorded", "/finance/cycle");
}

// ---------------- the monthly partner review and pay ----------------

export async function savePartnerReviewAction(form: FormData) {
  const user = await requireCan("settings:write");
  const m = month.parse(form.get("month"));
  const partners = all(form, "partner");
  const scores = all(form, "score");
  const notes = all(form, "notes");
  const r = await saveReview(db, m, partners.map((partner, i) => ({ partner, kpiScore: Math.round(num(scores[i])), notes: notes[i] })), user.id);
  done(form, r, "Scores saved", `/finance/pay?month=${m}`);
}

export async function approvePayAction(form: FormData) {
  const user = await requireCan("settings:write");
  const m = month.parse(form.get("month"));
  const r = await approvePay(db, m, user.id);
  done(form, r, "Pay approved: the amounts are in the ledger as Owed until they are paid", `/finance/pay?month=${m}`);
}

export async function undoPayAction(form: FormData) {
  const user = await requireCan("settings:write");
  const m = month.parse(form.get("month"));
  const r = await undoPay(db, m, user.id);
  done(form, r, "Approval undone", `/finance/pay?month=${m}`);
}

// ---------------- functions and owners ----------------

export async function saveFunctionAction(form: FormData) {
  const user = await requireCan("settings:write");
  const id = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable()).parse(form.get("id"));
  const r = await saveFunction(
    db,
    id,
    {
      name: String(form.get("name") ?? ""),
      appliesTo: String(form.get("appliesTo") ?? "both"),
      weight: num(form.get("weight")),
      description: String(form.get("description") ?? ""),
      accountable: String(form.get("accountable") ?? "") || null,
      supporting: all(form, "supporting"),
      staff: String(form.get("staff") ?? ""),
    },
    user.id,
  );
  done(form, r, id ? "Function saved" : "Function added", "/team/functions");
}

export async function removeFunctionAction(form: FormData) {
  const user = await requireCan("settings:write");
  const r = await removeFunction(db, z.coerce.number().int().positive().parse(form.get("id")), user.id);
  done(form, r, "Function removed", "/team/functions");
}
