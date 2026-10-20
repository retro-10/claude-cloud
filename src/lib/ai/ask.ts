import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { activities, aiMessages, aiThreads, consults, enrolments, leads, stageEvents, stages, type AiLookup } from "@/db/schema";
import type { AiSettings } from "../app-settings";
import { campaignStats } from "../campaigns";
import { listCohorts } from "../cohorts";
import { alerts } from "../command";
import { financeBoard, listCandidates, thisMonth } from "../finance";
import { standings } from "../graduation";
import { listLeads } from "../lead-list";
import { getMetrics } from "../metrics";
import { budgetVsActual } from "../money";
import { designerStats, productionPulse } from "../production";
import { can, type Role } from "../rbac";
import { studentRisks } from "../risk";
import { cairoYmd, formatCairo } from "../time";
import { VIEWS } from "../views";
import { AiError, callClaude, redact, textOf, type BetaMessageParam, type BetaTool } from "./core";

export type Viewer = { id: number; name: string; role: Role };
type Handler = (input: Record<string, unknown>) => Promise<{ data: unknown; summary: string }>;
type ToolDef = { tool: BetaTool; run: Handler };

const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d);

/**
 * The read-only tools Ask OrlaDent may use for this person. A tool is offered only when the owners allow that
 * kind of data (Settings > AI) AND this person may see it in the app themselves: the assistant never shows
 * anyone more than their own screens would. No tool writes anything; none returns a phone number or email.
 */
export function toolsFor(db: Db, v: Viewer, ai: AiSettings): ToolDef[] {
  const money = ai.readMoney && can(v.role, "finance:read");
  const leadsOk = ai.readLeads && can(v.role, "lead:read");
  const studentsOk = ai.readStudents && can(v.role, "lead:read");
  const productionOk = ai.readProduction && can(v.role, "production:read");
  const out: ToolDef[] = [];
  const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });

  if (can(v.role, "lead:read")) {
    out.push({
      tool: {
        name: "sales_numbers",
        description:
          "Sales funnel for leads created in a date range: total leads, how many reached each stage, consults booked/held/no-show, speed to first contact, enrolments, leads and enrolments by source and by campaign" +
          (money ? ", and revenue by tier, batch and source." : ". (Revenue is not available to this person.)") +
          " Dates are Cairo calendar days, YYYY-MM-DD. Leave both empty for all time.",
        input_schema: obj({ from: { type: "string", description: "First day, YYYY-MM-DD" }, to: { type: "string", description: "Last day, YYYY-MM-DD" } }),
      },
      run: async (i) => {
        const m = await getMetrics(db, { from: day(i.from), to: day(i.to) });
        const data = { leads: m.totalLeads, funnel: m.funnel, speed: m.speed, consults: m.consults, salesCycleDays: m.cycle, sources: m.sources, campaigns: m.campaigns, lost: m.leaks, ...(money ? { revenue: m.revenue } : {}) };
        return { data, summary: `Sales numbers${day(i.from) ? ` from ${day(i.from)}` : ""}${day(i.to) ? ` to ${day(i.to)}` : day(i.from) ? " to today" : ", all time"}` };
      },
    });
    out.push({
      tool: { name: "needs_attention", description: "Everything waiting on a person right now (the Command centre's list): late leads, overdue follow-ups and tasks, decisions due, and more, with links.", input_schema: obj({}) },
      run: async () => ({ data: (await alerts(db, v.role)).map((a) => ({ title: a.title, detail: a.detail, count: a.count, link: a.href })), summary: "What needs a person now" }),
    });
    out.push({
      tool: {
        name: "batches",
        description: "Every batch (cohort): seats used of the cap, status, masterclass / enrolment close / start dates" + (money ? ", and what its students owe in total." : "."),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await listCohorts(db);
        return {
          data: rows.map((b) => ({ id: b.id, name: b.name, status: b.status, seats: `${b.seatsUsed}/${b.seatCap}`, enrolmentCloses: b.enrolmentCloseAt ? cairoYmd(b.enrolmentCloseAt) : null, starts: b.startAt ? cairoYmd(b.startAt) : null, link: `/cohorts/${b.id}`, ...(money ? { revenueEgp: b.revenueEgp } : {}) })),
          summary: "Batches and seats",
        };
      },
    });
    out.push({
      tool: { name: "campaigns", description: "Every campaign (masterclass, ads, collaboration…): leads, consults, enrolments" + (money ? ", spend, cost per lead and per enrolment, revenue and return." : "."), input_schema: obj({}) },
      run: async () => {
        const rows = await campaignStats(db);
        return {
          data: rows.map((c) => ({ ...(Object.fromEntries(Object.entries(c).filter(([k]) => money || !/spend|owed|cost|revenue|roi/i.test(k))) as object), link: `/growth/campaigns/${c.id}` })),
          summary: "Campaign results",
        };
      },
    });
  }
  if (leadsOk) {
    out.push({
      tool: {
        name: "find_leads",
        description: `Find leads by name or note text, stage, or a smart view. Returns up to 25 with stage, source, owner, created and next follow-up, and a link. Views: ${Object.keys(VIEWS).join(", ")}.`,
        input_schema: obj({
          query: { type: "string", description: "Words in the name or notes" },
          stage: { type: "string", description: "Stage key, e.g. new, contacted, consult_booked, offer_sent, enrolled, lost, nurture" },
          view: { type: "string", description: "A smart view key" },
          limit: { type: "integer", description: "1 to 25" },
        }),
      },
      run: async (i) => {
        const r = await listLeads(db, { q: typeof i.query === "string" ? i.query.slice(0, 80) : undefined, stage: typeof i.stage === "string" ? i.stage : undefined, view: typeof i.view === "string" ? i.view : undefined });
        const rows = r.rows.slice(0, int(i.limit, 1, 25, 15)).map((l) => ({ id: l.id, name: l.fullName, stage: l.stageLabel ?? l.stage, source: l.source, owner: l.owner, created: cairoYmd(l.createdAt), nextFollowUp: l.nextFollowUp ? cairoYmd(new Date(l.nextFollowUp)) : null, link: `/leads/${l.id}` }));
        return { data: { total: r.total, rows }, summary: `Leads${i.query ? ` matching “${String(i.query).slice(0, 40)}”` : ""}${i.stage ? ` in ${i.stage}` : ""}${i.view ? ` (${i.view})` : ""}` };
      },
    });
    out.push({
      tool: {
        name: "lead_history",
        description: "One lead in detail: stage, source, tier interest, notes, stage changes, the last 15 messages and notes logged (phone numbers and emails removed), consults and their outcomes, and the offer" + (money ? " and payments." : "."),
        input_schema: obj({ lead_id: { type: "integer" } }, ["lead_id"]),
      },
      run: async (i) => {
        const id = int(i.lead_id, 1, 2 ** 31 - 1, 0);
        const [l] = await db.select({ l: leads, stage: stages.label }).from(leads).leftJoin(stages, eq(stages.key, leads.stage)).where(eq(leads.id, id));
        if (!l || l.l.deletedAt) return { data: { error: "No such lead" }, summary: "A lead (not found)" };
        const [evs, acts, cons, ens] = await Promise.all([
          db.select().from(stageEvents).where(eq(stageEvents.leadId, id)).orderBy(asc(stageEvents.at)),
          db.select().from(activities).where(eq(activities.leadId, id)).orderBy(desc(activities.at)).limit(15),
          db.select().from(consults).where(eq(consults.leadId, id)).orderBy(desc(consults.scheduledAt)),
          money ? listCandidates(db, { leadId: id }) : db.select({ cohortId: enrolments.cohortId, tier: enrolments.tier, status: enrolments.status }).from(enrolments).where(eq(enrolments.leadId, id)),
        ]);
        const L = l.l;
        return {
          data: {
            name: L.fullName,
            stage: l.stage ?? L.stage,
            segment: L.segment,
            tierInterest: L.tierInterest,
            created: cairoYmd(L.createdAt),
            notes: L.notes ? redact(L.notes).slice(0, 1500) : null,
            offer: L.offerSentAt ? { sent: cairoYmd(L.offerSentAt), decisionDue: L.decisionDueAt ? cairoYmd(L.decisionDueAt) : null } : null,
            stageChanges: evs.map((e) => ({ to: e.toStage, at: formatCairo(e.at) })),
            recent: acts.map((a) => ({ at: formatCairo(a.at), type: a.type, direction: a.direction, text: a.body ? redact(a.body).slice(0, 400) : null })),
            consults: cons.map((c) => ({ at: formatCairo(c.scheduledAt), outcome: c.outcome })),
            enrolments: ens,
            link: `/leads/${id}`,
          },
          summary: `${L.fullName}'s history`,
        };
      },
    });
  }
  if (studentsOk) {
    out.push({
      tool: {
        name: "students",
        description: "A batch's students against its graduation rules: attendance rate, assignments passed, what is missing, certificate, early-warning drop risk with reasons" + (money ? ", and what each still owes." : "."),
        input_schema: obj({ batch_id: { type: "integer" } }, ["batch_id"]),
      },
      run: async (i) => {
        const batch = int(i.batch_id, 1, 2 ** 31 - 1, 0);
        const [s, risks] = await Promise.all([standings(db, batch), studentRisks(db, { cohortId: batch, money })]);
        const risk = new Map(risks.map((r) => [r.enrolmentId, r]));
        return {
          data: { rules: s.rules, students: s.rows.map((r) => ({ dropRisk: risk.get(r.enrolmentId) ? { level: risk.get(r.enrolmentId)!.level, reasons: risk.get(r.enrolmentId)!.reasons } : "none", name: r.fullName, status: r.status, attendance: r.attendance, passed: `${r.passed}/${r.assignments}`, missing: r.missing, certificate: r.certificate?.code ?? null, link: `/leads/${r.leadId}`, ...(money ? { stillOwesEgp: r.remaining } : {}) })) },
          summary: "Students of a batch",
        };
      },
    });
  }
  if (money && can(v.role, "finance:read")) {
    out.push({
      tool: {
        name: "money_month",
        description: "The books for one month (YYYY-MM, default this month): received, costs, net, capital left, each partner's share and balance, 12-month series, the coming-up list, and budget vs actual by cost category.",
        input_schema: obj({ month: { type: "string", description: "YYYY-MM" } }),
      },
      run: async (i) => {
        const month = typeof i.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(i.month) ? i.month : thisMonth();
        const [b, budget] = await Promise.all([financeBoard(db, month), budgetVsActual(db, month)]);
        return {
          data: { month, totals: b.month_, balances: b.balances, capitalBalance: b.capitalBalance, series: b.series, comingUp: b.comingUp.slice(0, 20).map((e) => ({ entry: e.entry, amountEgp: e.amountEgp, status: e.status, date: e.date ? cairoYmd(e.date) : null })), budget: budget.rows.filter((r) => r.budget || r.paid || r.owed), link: `/finance?month=${month}` },
          summary: `The books for ${month}`,
        };
      },
    });
  }
  if (productionOk && (can(v.role, "production:manage") || can(v.role, "finance:read"))) {
    out.push({
      tool: { name: "production", description: "The production studio now: open, late, waiting for QC, unassigned and to-invoice cases, and each designer's last 90 days (delivered, first-time QC pass, on time, turnaround).", input_schema: obj({}) },
      run: async () => ({ data: { now: await productionPulse(db), designers: await designerStats(db, new Date(Date.now() - 90 * 86_400_000)), link: "/production" }, summary: "Production studio" }),
    });
  }
  return out;
}

const SYSTEM = `You are Ask OrlaDent, the assistant inside OrlaDent OS, the app that runs OrlaDent Camp (a dental design training camp in Egypt) and its production studio.

How you work:
- Answer only from what your tools return. If the tools cannot answer it, say so plainly and say which screen in the app would show it. Never guess or invent a figure, a name or a date.
- You can only read. You cannot send messages, change records, or move leads; if asked, say what the person can do in the app instead.
- Be brief and concrete: lead with the answer, then the figures that support it. Use short bullet lists for several items. Money in EGP with thousands separators. Dates are Cairo time.
- Link to records with markdown links using the "link" paths the tools return, e.g. [Demo Lead 3](/leads/12). Use only paths a tool returned.
- If a percentage rests on fewer than 5 records, give the counts instead.
- Write in the language the person wrote in (English, or Egyptian Arabic).`;

const MAX_STEPS = 6;

/** One question in a conversation: runs the tool loop, saves the question and the answer, returns the answer. */
export async function ask(db: Db, v: Viewer, threadId: number | null, question: string, ai: AiSettings): Promise<{ threadId: number; answer: string; lookups: AiLookup[] }> {
  const q = question.trim().slice(0, 2000);
  if (!q) throw new AiError("Ask a question");
  let thread = threadId ? (await db.select().from(aiThreads).where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, v.id))))[0] : undefined;
  if (threadId && !thread) throw new AiError("Conversation not found");
  const history = thread
    ? (await db.select().from(aiMessages).where(eq(aiMessages.threadId, thread.id)).orderBy(desc(aiMessages.id)).limit(12)).reverse()
    : [];
  const defs = toolsFor(db, v, ai);
  const byName = new Map(defs.map((d) => [d.tool.name, d]));
  const messages: BetaMessageParam[] = [...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })), { role: "user", content: q }];
  const context = `The person asking: ${v.name} (role: ${v.role}). Today: ${formatCairo(new Date())} Cairo time.${defs.length ? "" : " No data tools are available to this person."}`;
  const lookups: AiLookup[] = [];
  let answer = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callClaude(db, { userId: v.id, feature: "ask", system: SYSTEM, context, messages, tools: defs.map((d) => d.tool), effort: "medium" });
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      answer = textOf(res);
      if (res.stop_reason === "max_tokens") answer += "\n\n(The answer was cut short. Ask a narrower question.)";
      break;
    }
    const results = await Promise.all(
      calls.map(async (c) => {
        const def = byName.get(c.name);
        if (!def) return { type: "tool_result" as const, tool_use_id: c.id, content: "That tool is not available.", is_error: true };
        try {
          const input = c.input && typeof c.input === "object" ? (c.input as Record<string, unknown>) : {};
          const r = await def.run(input);
          lookups.push({ tool: c.name, summary: r.summary });
          return { type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(r.data).slice(0, 60_000) };
        } catch {
          return { type: "tool_result" as const, tool_use_id: c.id, content: "The lookup failed.", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  if (!answer) answer = "I could not finish that in a few steps. Try a narrower question.";
  const now = new Date();
  if (!thread) [thread] = await db.insert(aiThreads).values({ userId: v.id, title: q.slice(0, 80) }).returning();
  else await db.update(aiThreads).set({ updatedAt: now }).where(eq(aiThreads.id, thread.id));
  await db.insert(aiMessages).values([
    { threadId: thread.id, role: "user", content: q },
    { threadId: thread.id, role: "assistant", content: answer, lookups },
  ]);
  return { threadId: thread.id, answer, lookups };
}

export const listThreads = (db: Db, userId: number) => db.select().from(aiThreads).where(eq(aiThreads.userId, userId)).orderBy(desc(aiThreads.updatedAt)).limit(30);

export async function threadMessages(db: Db, userId: number, threadId: number) {
  const [t] = await db.select().from(aiThreads).where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, userId)));
  if (!t) return null;
  return { thread: t, messages: await db.select().from(aiMessages).where(eq(aiMessages.threadId, threadId)).orderBy(asc(aiMessages.id)) };
}

export async function deleteThread(db: Db, userId: number, threadId: number) {
  const [t] = await db.select().from(aiThreads).where(and(eq(aiThreads.id, threadId), eq(aiThreads.userId, userId)));
  if (!t) return;
  await db.delete(aiMessages).where(eq(aiMessages.threadId, threadId));
  await db.delete(aiThreads).where(eq(aiThreads.id, threadId));
}

export const SUGGESTIONS = [
  "Which source brought the most enrolments this quarter?",
  "Who is waiting longest for a reply, and what did they ask?",
  "How full is each batch, and when does enrolment close?",
  "Which leads have an offer out with no decision yet?",
];
