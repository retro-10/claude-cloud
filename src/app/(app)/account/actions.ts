"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/server-auth";
import { beginSetup, confirmSetup, disableTwoFactor, regenerateRecoveryCodes } from "@/lib/two-factor";

// Everyone manages their own two-factor here. Codes come back in the form state (never in a URL or a log).
export type TwoFactorState = { error?: string; recoveryCodes?: string[]; done?: string };

const code = (form: FormData) => String(form.get("code") ?? "").slice(0, 40);

export async function startTwoFactorAction() {
  const user = await requireUser();
  const r = await beginSetup(db, user.id);
  revalidatePath("/account");
  redirect(r.ok ? "/account#two-factor" : `/account?error=${encodeURIComponent(r.error)}`);
}

export async function confirmTwoFactorAction(_prev: TwoFactorState, form: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  const r = await confirmSetup(db, user.id, code(form));
  if (!r.ok) return { error: r.error };
  // no revalidate here: a refresh would swap this form for the "on" view and lose the codes before they are
  // saved. The codes panel has a button that reloads the page once they are written down.
  return { recoveryCodes: r.recoveryCodes, done: "Two-factor sign-in is on." };
}

export async function newRecoveryCodesAction(_prev: TwoFactorState, form: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  const r = await regenerateRecoveryCodes(db, user.id, code(form));
  if (!r.ok) return { error: r.error };
  return { recoveryCodes: r.recoveryCodes, done: "New recovery codes made; the old ones no longer work." };
}

export async function disableTwoFactorAction(_prev: TwoFactorState, form: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  const r = await disableTwoFactor(db, user.id, code(form));
  if (!r.ok) return { error: r.error };
  revalidatePath("/", "layout");
  return { done: "Two-factor sign-in is off." };
}
