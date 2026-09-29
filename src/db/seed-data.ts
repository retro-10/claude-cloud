import type { CadenceStep } from "./schema";

export const STAGES = [
  { key: "new", label: "New", position: 1, kind: "open" },
  { key: "contacted", label: "Contacted", position: 2, kind: "open" },
  { key: "replied", label: "Replied", position: 3, kind: "open" },
  { key: "consult_booked", label: "Consult booked", position: 4, kind: "open" },
  { key: "consult_held", label: "Consult held", position: 5, kind: "open" },
  { key: "offer_sent", label: "Offer sent", position: 6, kind: "open" },
  { key: "enrolled", label: "Enrolled", position: 7, kind: "won" },
  { key: "lost", label: "Lost", position: 8, kind: "lost" },
  { key: "nurture", label: "Nurture", position: 9, kind: "nurture" },
] as const;

export const SOURCES = [
  "Instagram",
  "Facebook group",
  "Masterclass",
  "Referral",
  "LinkedIn",
  "Direct",
  "Other",
];

export const OBJECTIONS = ["Price", "Time", "Trust", "Outcome", "Hardware", "Other"];

// Day-one lost reasons are a guess; confirm with Retro (see QUESTIONS.md).
export const LOST_REASONS = [
  "Price",
  "Timing",
  "No response",
  "Not a fit",
  "Chose competitor",
  "Hardware",
  "Other",
];

export const CADENCES: { name: string; steps: CadenceStep[] }[] = [
  {
    name: "Outreach, 14 days",
    steps: [
      { offset_days: 0, kind: "whatsapp", message_hint: "Warm-up: light, personal touch. No pitch." },
      { offset_days: 1, kind: "whatsapp", message_hint: "First message with the masterclass link." },
      { offset_days: 4, kind: "whatsapp", message_hint: "Share a value clip." },
      { offset_days: 8, kind: "whatsapp", message_hint: "Share proof (student result)." },
      { offset_days: 12, kind: "whatsapp", message_hint: "Real enrolment deadline." },
      { offset_days: 14, kind: "whatsapp", message_hint: "Close the loop." },
    ],
  },
  {
    name: "Post-consult",
    steps: [
      { offset_days: 0, kind: "whatsapp", message_hint: "Voice-note recap of the consult." },
      { offset_days: 2, kind: "whatsapp", message_hint: "Proof that answers their objection." },
      { offset_days: 5, kind: "whatsapp", message_hint: "Answer to their open question." },
      { offset_days: 7, kind: "whatsapp", message_hint: "Decision message with the real close date." },
    ],
  },
];

export const DEMO_USERS = [
  { name: "Retro", email: "retro@orladent.local", role: "owner" },
  { name: "Badr", email: "badr@orladent.local", role: "owner" },
  { name: "Murail", email: "murail@orladent.local", role: "viewer" },
] as const;
