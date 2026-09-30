import type { CadenceStep, RuleAction } from "./schema";

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

// Added in Release 1.1 (blueprint P5). "No decision" = went silent after the offer; it is reported apart
// from an explicit no. Existing reasons are kept: past leads point at them.
export const LOST_REASONS_1_1: { label: string; kind: "explicit" | "no_decision" }[] = [
  { label: "Trust", kind: "explicit" },
  { label: "No time", kind: "explicit" },
  { label: "Chose free content", kind: "explicit" },
  { label: "No decision", kind: "no_decision" },
];

// P1 defaults: which checks must pass to ENTER each stage (see src/lib/exit-criteria.ts)
export const DEFAULT_CRITERIA: Record<string, string[]> = {
  contacted: ["outbound_logged"],
  replied: ["inbound_logged"],
  consult_booked: ["consult_confirmed"],
  consult_held: ["consult_held", "consult_objections", "consult_tier"],
  offer_sent: ["offer_tier", "offer_price", "offer_link_sent", "decision_date"],
  enrolled: ["payment_reference"],
  lost: ["lost_reason"],
  nurture: ["next_step"],
};

// W1: the seven built-in rules from the blueprint, plus the A3 escalation for unassigned leads.
// Rules never send messages: they create follow-ups, tags and in-app notifications.
export const BUILTIN_RULES: {
  key: string;
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  actions: RuleAction[];
  position: number;
}[] = [
  {
    key: "new_lead_reply",
    name: "New lead: reply within 5 minutes",
    trigger: "lead_created",
    conditions: {},
    actions: [
      { type: "create_follow_up", kind: "reply", note: "Reply within 5 minutes", dueInMinutes: 5 },
      { type: "notify", title: "New lead: {name}" },
    ],
    position: 1,
  },
  {
    key: "inbound_reply",
    name: "They replied: stop the cadence and reply now",
    trigger: "inbound_logged",
    conditions: {},
    actions: [
      { type: "cancel_follow_ups" },
      { type: "create_follow_up", kind: "reply", note: "They replied: answer them", dueInMinutes: 0 },
    ],
    position: 2,
  },
  {
    key: "consult_thinking",
    name: "Consult held, still thinking: start the post-consult cadence",
    trigger: "consult_outcome",
    conditions: { result: "held", outcome: "thinking" },
    actions: [{ type: "apply_cadence", cadence: "Post-consult" }],
    position: 3,
  },
  {
    key: "consult_no_show",
    name: "Consult no-show: recover within 2 hours",
    trigger: "consult_outcome",
    conditions: { result: "no_show" },
    actions: [{ type: "create_follow_up", kind: "whatsapp", note: "No-show: offer a new time", dueInMinutes: 120 }],
    position: 4,
  },
  {
    key: "offer_decision",
    name: "Offer sent: follow up on the agreed decision date",
    trigger: "stage_changed",
    conditions: { to_stage: "offer_sent" },
    actions: [{ type: "create_follow_up", kind: "whatsapp", note: "Decision day: ask for their answer", dueAt: "decision_date" }],
    position: 5,
  },
  {
    key: "overdue_24h",
    name: "Follow-up overdue by 24 hours: notify",
    trigger: "follow_up_overdue",
    conditions: { overdue_hours: "24" },
    actions: [{ type: "notify", title: "Overdue 24h: {name}" }],
    position: 6,
  },
  {
    key: "lost_cleanup",
    name: "Lost: cancel follow-ups, send price and timing losses to nurture review",
    trigger: "stage_changed",
    conditions: { to_stage: "lost" },
    actions: [{ type: "cancel_follow_ups" }, { type: "add_tag", tag: "nurture-review", ifLostReasons: ["Price", "Timing"] }],
    position: 7,
  },
  {
    key: "unassigned_escalation",
    name: "Unassigned new lead past the red response time: alert the owners",
    trigger: "sla_breached",
    conditions: { unassigned: "1" },
    actions: [{ type: "notify", title: "Nobody has answered {name} yet" }],
    position: 8,
  },
];

// M1: neutral starter templates. No prices, incentives, guarantees or outcome claims: those need
// Badr's approval first (blueprint rule 5). Deadlines only ever come from the cohort record.
export const TEMPLATES: { name: string; category: string; language: "ar" | "en"; body: string }[] = [
  {
    name: "First reply",
    category: "first_reply",
    language: "ar",
    body: "أهلاً {first_name}، شكراً إنك تواصلت مع OrlaDent Camp. هسألك سؤالين سريعين عشان أعرف إذا كان الكورس مناسب ليك. تمام؟",
  },
  {
    name: "First reply",
    category: "first_reply",
    language: "en",
    body: "Hi {first_name}, thanks for reaching out to OrlaDent Camp. Can I ask you two quick questions to see whether the course fits what you need?",
  },
  {
    name: "Masterclass invite",
    category: "masterclass_invite",
    language: "ar",
    body: "أهلاً {first_name}، الماستر كلاس الجاية يوم {masterclass_date}. تحب أبعتلك اللينك؟",
  },
  {
    name: "Masterclass invite",
    category: "masterclass_invite",
    language: "en",
    body: "Hi {first_name}, our next masterclass is on {masterclass_date}. Would you like the link?",
  },
  {
    name: "Consult reminder",
    category: "consult_reminder",
    language: "ar",
    body: "أهلاً {first_name}، تذكير بمكالمتنا {consult_time} بتوقيت القاهرة. لو محتاج تغيّر المعاد قولّي.",
  },
  {
    name: "Consult reminder",
    category: "consult_reminder",
    language: "en",
    body: "Hi {first_name}, a reminder of our call on {consult_time} (Cairo time). Let me know if you need to change it.",
  },
  {
    name: "Post-consult recap",
    category: "post_consult_recap",
    language: "en",
    body: "Thanks for the call today, {first_name}. As we discussed, here are the details for the {tier} tier. The payment link is here whenever you're ready: {payment_link}",
  },
  {
    name: "Decision check-in",
    category: "decision_nudge",
    language: "en",
    body: "Hi {first_name}, you mentioned you'd decide by {decision_date}. Is there anything I can answer to help?",
  },
  {
    name: "Decision check-in",
    category: "decision_nudge",
    language: "ar",
    body: "أهلاً {first_name}، كنت قلت إنك هتقرر يوم {decision_date}. فيه أي سؤال أقدر أجاوبك عليه؟",
  },
  {
    name: "Enrolment close date",
    category: "deadline_notice",
    language: "en",
    body: "Hi {first_name}, enrolment for {cohort_name} closes on {cohort_close_date}.",
  },
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
  { name: "Sayed", email: "sayed@orladent.local", role: "owner" }, // admin
  { name: "Mo", email: "mo@orladent.local", role: "finance" }, // financial admin
] as const;

// Accounts that were seeded before and must not exist any more. The seed deletes them, or
// deactivates them if they already have history (activities, audit rows) pointing at them.
export const REMOVED_USERS = ["murail@orladent.local"];
