"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { addDocument, decideChange, newDocumentVersion, saveEmployee } from "@/lib/employees";
import type { Result } from "@/lib/result";
import { requireCan, requireTwoFactor } from "@/lib/server-auth";

const id = z.coerce.number().int().positive();
const text = (max: number) => z.preprocess((v) => (v == null ? "" : v), z.string().max(max));
const optInt = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().nullable());

function go(to: string, r: Result, notice: string): never {
  revalidatePath("/employees");
  const sep = to.includes("?") ? "&" : "?";
  redirect(r.ok ? `${to}${sep}notice=${encodeURIComponent(notice)}` : `${to}${sep}error=${encodeURIComponent(r.error)}`);
}

const fileOf = async (form: FormData) => {
  const f = form.get("file");
  return f instanceof File && f.size ? { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) } : null;
};

export async function saveEmployeeAction(form: FormData) {
  const user = await requireCan("employee:manage");
  requireTwoFactor(user);
  const p = z
    .object({
      userId: id,
      workerType: text(20),
      jobTitle: text(200),
      startDate: text(10),
      endDate: text(10),
      managerId: optInt,
      payTerms: text(400),
      payAmountEgp: optInt,
      paySchedule: text(200),
      noticePeriod: text(200),
      teamMemberId: optInt,
    })
    .parse(Object.fromEntries(form));
  go(`/employees/${p.userId}`, await saveEmployee(db, user.id, p.userId, p), "Record saved");
}

export async function addDocumentAction(form: FormData) {
  const user = await requireCan("employee:manage");
  requireTwoFactor(user);
  const p = z.object({ userId: id, category: text(30), title: text(160), needsAck: z.preprocess((v) => v === "on", z.boolean()) }).parse(Object.fromEntries(form));
  go(`/employees/${p.userId}`, await addDocument(db, user.id, p.userId, p, await fileOf(form)), "Document added; they have been asked to read it");
}

export async function newDocumentVersionAction(form: FormData) {
  const user = await requireCan("employee:manage");
  requireTwoFactor(user);
  const p = z.object({ id, userId: id }).parse(Object.fromEntries(form));
  go(`/employees/${p.userId}`, await newDocumentVersion(db, user.id, p.id, await fileOf(form)), "New version added; the old one is kept");
}

export async function decideChangeAction(form: FormData) {
  const user = await requireCan("employee:manage");
  requireTwoFactor(user);
  const p = z.object({ id, userId: id, decision: z.enum(["apply", "decline"]), note: text(1000) }).parse(Object.fromEntries(form));
  go(`/employees/${p.userId}`, await decideChange(db, user, p.id, p.decision === "apply", p.note), p.decision === "apply" ? "Change made" : "Declined");
}
