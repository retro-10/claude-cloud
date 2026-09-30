import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { consentRecords, leads } from "@/db/schema";
import { audit } from "./audit";

/**
 * G1: whether a lead agreed to be contacted on WhatsApp, when and how. The newest record wins; older
 * ones are kept as history. "Do not contact" is a separate hard stop that hides every send action.
 * (Egypt's Law 151 of 2020 applies to personal data: confirm obligations with a lawyer.)
 */
export const CONSENT_METHODS = {
  messaged_first: "They messaged us first",
  form: "Ticked consent on a form",
  asked_in_chat: "Said yes when asked in chat",
  verbal: "Said yes on a call",
  refused: "Asked us not to contact them",
} as const;
export type ConsentMethod = keyof typeof CONSENT_METHODS;

export async function currentConsent(db: Pick<Db, "select">, leadId: number) {
  const [r] = await db
    .select()
    .from(consentRecords)
    .where(and(eq(consentRecords.leadId, leadId), eq(consentRecords.channel, "whatsapp")))
    .orderBy(desc(consentRecords.at), desc(consentRecords.id))
    .limit(1);
  return r ?? null;
}

export async function recordConsent(db: Db, input: { leadId: number; granted: boolean; method: ConsentMethod }, userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.insert(consentRecords).values({ leadId: input.leadId, channel: "whatsapp", granted: input.granted, method: input.method, byUserId: userId });
    // a refusal is also a do-not-contact: the send buttons disappear at once
    if (!input.granted) await tx.update(leads).set({ doNotContact: true, updatedAt: new Date() }).where(eq(leads.id, input.leadId));
    await audit(tx, { userId, entity: "lead", entityId: input.leadId, action: "consent", diff: { granted: input.granted, method: input.method } });
  });
}

export async function setDoNotContact(db: Db, leadId: number, value: boolean, userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ doNotContact: value, updatedAt: new Date() }).where(eq(leads.id, leadId));
    await audit(tx, { userId, entity: "lead", entityId: leadId, action: value ? "do_not_contact" : "contact_allowed" });
  });
}
