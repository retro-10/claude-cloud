// Tier prices in EGP (Brand Guardrails, confirmed 2026-09-23). They pre-fill the enrolment form;
// the agreed price and any discount are kept per candidate.
export const LIST_PRICE_EGP: Record<"foundation" | "freelance_ready" | "production_partner", number> = {
  foundation: 7500,
  freelance_ready: 15000,
  production_partner: 30000,
};

export const TIER_LABEL: Record<string, string> = {
  foundation: "Foundation",
  freelance_ready: "Freelance Ready",
  production_partner: "Production Partner",
};

/** The prices an owner set in Settings, as tier -> EGP (falls back to the list above for a missing tier). */
export function priceMap(prices: { key: string; price: number }[]): Record<string, number> {
  return { ...LIST_PRICE_EGP, ...Object.fromEntries(prices.map((p) => [p.key, p.price])) };
}
