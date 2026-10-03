"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { activeForm, checkStamp, cleanAttribution, hashIp, intake } from "@/lib/lead-forms";
import { rateLimit } from "@/lib/rate-limit";

export type FormState = { done?: boolean; error?: string; field?: "name" | "phone" | "email" | "consent" };

const MAX_PER_IP = Number(process.env.FORM_MAX_PER_IP ?? 5);
const blank = (v: unknown) => (v === "" || v == null ? null : v);

// Public: anyone can post. The defences are a hidden honeypot field, a signed "page shown at" stamp (no
// posting without loading the page, nor within 2 seconds), 5 sign-ups per address per 10 minutes, and a
// thank-you that reads the same whether or not the person was already a lead.
export async function submitFormAction(_prev: FormState, form: FormData): Promise<FormState> {
  const f = await activeForm(db, String(form.get("slug") ?? ""));
  if (!f) return { error: "This form is closed." };
  if (String(form.get("website") ?? "")) return { done: true }; // the honeypot: a bot filled it in
  const stamp = checkStamp(f.id, String(form.get("t") ?? ""));
  if (stamp === "bad" || stamp === "too_fast") return { done: true }; // not a person on our page: say nothing useful
  if (stamp === "expired") return { error: "This page was open for a long time. Reload it and send again." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`form:${ip}`, MAX_PER_IP, 10 * 60_000).ok) return { error: "Too many sign-ups from this connection. Try again in a few minutes." };

  const p = z
    .object({
      name: z.string().max(300),
      phone: z.string().max(40),
      email: z.preprocess(blank, z.string().max(300).nullable()),
      city: z.preprocess(blank, z.string().max(200).nullable()),
      segment: z.preprocess(blank, z.enum(["fresh_graduate", "technician", "dentist", "other"]).nullable()),
      tier: z.preprocess(blank, z.enum(["foundation", "freelance_ready", "production_partner", "unsure"]).nullable()),
      consent: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Please check the form and send again." };
  if (p.data.consent !== "on") return { error: "Please tick the box so we may message you on WhatsApp.", field: "consent" };

  const attribution = cleanAttribution(Object.fromEntries(form));
  const r = await intake(db, {
    name: p.data.name,
    phone: p.data.phone,
    email: f.askEmail ? p.data.email : null,
    city: f.askCity ? p.data.city : null,
    segment: f.askSegment ? p.data.segment : null,
    tier: f.askTier ? p.data.tier : null,
    consent: true,
    attribution,
    formId: f.id,
    campaignId: f.campaignId,
    sourceId: f.sourceId,
    channel: "form",
    ipHash: hashIp(ip),
  });
  if (!r.ok)
    return {
      error: { name: "Please write your name.", phone: "Please check your WhatsApp number (Egyptian numbers can start with 01).", email: "Please check your email address." }[r.error],
      field: r.error,
    };
  return { done: true };
}
