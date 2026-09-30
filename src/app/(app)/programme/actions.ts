"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { deleteProof, deleteSession, saveProof, saveSession, updateProgramme } from "@/lib/programme";
import { safePath } from "@/lib/safe-path";
import { requireCan } from "@/lib/server-auth";

// Programme data (content consent, QC, sessions, proof) is edited by whoever works the lead: owners and sales.
const id = z.coerce.number().int().positive();
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const optNum = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nullable());
const text = (max: number) => z.string().max(max).optional();

function back(form: FormData, r: { ok: boolean; error?: string }, ok: string): never {
  const path = safePath(form.get("back"), "/proof");
  const sep = path.includes("?") ? "&" : "?";
  revalidatePath("/proof");
  revalidatePath("/cohorts", "layout");
  redirect(`${path}${sep}${r.ok ? `notice=${encodeURIComponent(ok)}` : `error=${encodeURIComponent(r.error ?? "Could not save")}`}`);
}

export async function updateProgrammeAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z.object({ enrolmentId: id, qcScore: optNum, leaderboardRank: optNum }).safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "QC score and rank must be numbers." }, "");
  const d = p.data!;
  back(
    form,
    await updateProgramme(
      db,
      d.enrolmentId,
      { contentConsent: form.get("contentConsent") === "on", contentConsentScope: form.getAll("contentConsentScope").map(String), qcScore: d.qcScore, leaderboardRank: d.leaderboardRank },
      user.id,
    ),
    "Programme saved",
  );
}

export async function saveSessionAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z
    .object({ id: optId, enrolmentId: optId, name: z.string().max(200), type: text(80), dayOfWeek: text(20), time: text(40), driveLink: text(500), notes: text(5000) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "Check the session details." }, "");
  const d = p.data!;
  back(form, await saveSession(db, d.id, { ...d, recorded: form.get("recorded") === "on" }, user.id), d.id ? "Session updated" : "Session added");
}

export async function deleteSessionAction(form: FormData) {
  const user = await requireCan("lead:write");
  await deleteSession(db, id.parse(form.get("id")), user.id);
  back(form, { ok: true }, "Session deleted");
}

export async function saveProofAction(form: FormData) {
  const user = await requireCan("lead:write");
  const p = z
    .object({ id: optId, enrolmentId: optId, name: z.string().max(200), type: text(40), consentStatus: text(20), fileOrLink: text(500), quote: text(10000) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) back(form, { ok: false, error: "Check the item details." }, "");
  const d = p.data!;
  back(form, await saveProof(db, d.id, { ...d, usableIn: form.getAll("usableIn").map(String) }, user.id), d.id ? "Item updated" : "Item added");
}

export async function deleteProofAction(form: FormData) {
  const user = await requireCan("lead:write");
  await deleteProof(db, id.parse(form.get("id")), user.id);
  back(form, { ok: true }, "Item deleted");
}
