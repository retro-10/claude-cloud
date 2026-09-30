// Pure template helpers, safe to import in client components (no database code).

/**
 * M1 placeholders. Every value comes from the lead, its consult or the cohort record: deadlines and
 * dates are never typed into a template (E2: honest scarcity). A value that is missing is reported,
 * never rendered as blank text.
 */
export const PLACEHOLDERS = {
  first_name: "Lead's first name",
  tier: "Offered tier, or the tier they are interested in",
  payment_link: "Payment link saved on the lead's offer",
  decision_date: "Decision date the lead agreed to",
  consult_time: "Next consult date and time (Cairo)",
  cohort_name: "Name of the next batch still open for enrolment",
  cohort_close_date: "That batch's enrolment close date",
  masterclass_date: "That batch's masterclass date",
} as const;
export type Placeholder = keyof typeof PLACEHOLDERS;

export const CATEGORIES: Record<string, string> = {
  first_reply: "First reply",
  masterclass_invite: "Masterclass invite",
  consult_reminder: "Consult reminder",
  post_consult_recap: "Post-consult recap",
  objection_reply: "Objection reply",
  decision_nudge: "Decision nudge",
  deadline_notice: "Deadline notice",
  referral_ask: "Referral ask",
};

export type TemplateContext = Partial<Record<Placeholder, string>>;

const TOKEN = /\{([a-z_]+)\}/g;

/** Fills known placeholders. Unknown or missing ones stay visible as {name} and are listed. */
export function renderTemplate(body: string, ctx: TemplateContext): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(TOKEN, (whole, key: string) => {
    const v = ctx[key as Placeholder];
    if (v) return v;
    missing.add(key);
    return whole;
  });
  return { text, missing: [...missing] };
}

/** Placeholders still unfilled in text the user may have edited. */
export const unfilled = (text: string) => [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];

export function unknownPlaceholders(body: string): string[] {
  return unfilled(body).filter((k) => !(k in PLACEHOLDERS));
}

/** wa.me link that opens the chat with the text already typed (nothing is sent until the user taps send). */
export function whatsappPrefill(e164: string | null | undefined, text: string): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}
