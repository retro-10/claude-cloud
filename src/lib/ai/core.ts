import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { aiUsage } from "@/db/schema";
import { getSettings, type AiSettings } from "../app-settings";
import { can, type Role } from "../rbac";
import { startOfCairoDay } from "../time";
import { fakeAllowed, fakeCreate } from "./fake";

export type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type BetaTool = Anthropic.Beta.Messages.BetaTool;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Create = (p: CreateParams) => Promise<BetaMessage>;

/**
 * The one way the app talks to Claude. Everything is off unless an owner switched the assistant on (Settings >
 * AI) and the server has an API key (ANTHROPIC_API_KEY). The model is Claude Opus 5.5 unless AI_MODEL says
 * otherwise; refusals fall back server-side to the model Anthropic picks for that case.
 */
export const AI_MODEL = process.env.AI_MODEL?.trim() || "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let testCreate: Create | null = null;
/** Tests replace Claude with a fake; never used in the app. */
export function setAiForTests(fn: Create | null) {
  testCreate = fn;
}

let client: Anthropic | null = null;
function create(): Create | null {
  if (testCreate) return testCreate;
  if (fakeAllowed()) return fakeCreate;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  const c = client;
  return (p) => c.beta.messages.create(p);
}

export type AiStatus = { ok: true; settings: AiSettings } | { ok: false; reason: string; settings: AiSettings };

/** Can the assistant be used right now, and if not, why (in words a person can act on)? */
export async function aiStatus(db: Db): Promise<AiStatus> {
  const { ai } = await getSettings(db);
  if (!create()) return { ok: false, reason: "The AI assistant needs an Anthropic API key on the server (ANTHROPIC_API_KEY). Whoever runs the server can add it.", settings: ai };
  if (!ai.enabled) return { ok: false, reason: "The AI assistant is switched off. An owner can switch it on in Settings > AI.", settings: ai };
  return { ok: true, settings: ai };
}

/** Should a page offer AI buttons to this person? (On, a key, and the person may use it.) */
export async function aiOffered(db: Db, role: Role) {
  return can(role, "ai:use") && (await aiStatus(db)).ok;
}

export class AiError extends Error {}

/** Phone numbers and email addresses never leave the app, even inside notes and messages. */
export function redact(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+|00)?\d[\d\s().-]{7,}\d/g, (m) => {
      // dates (2026-09-01, 01/09/2026) and grouped amounts (12,500,000) are not phone numbers
      if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m.trim())) return m;
      return m.replace(/\D/g, "").length >= 8 ? "[phone]" : m;
    });
}

export async function usedToday(db: Db, userId: number, now = new Date()) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startOfCairoDay(now))));
  return Number(n);
}

export type CallInput = {
  userId: number;
  feature: string;
  system: string; // stable instructions first: cached
  context?: string; // per-request facts, after the cache breakpoint
  messages: BetaMessageParam[];
  tools?: BetaTool[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

/**
 * One request to Claude. Checks the switch and the person's daily limit, records the tokens used (no content),
 * and turns API failures into messages a person can act on. Throws AiError.
 */
export async function callClaude(db: Db, input: CallInput): Promise<BetaMessage> {
  const status = await aiStatus(db);
  if (!status.ok) throw new AiError(status.reason);
  if ((await usedToday(db, input.userId)) >= status.settings.dailyLimit) throw new AiError(`You have used today's ${status.settings.dailyLimit} AI requests. It resets at midnight (Cairo time).`);
  const send = create()!;
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }];
  if (input.context) system.push({ type: "text", text: input.context });
  const record = (v: Partial<typeof aiUsage.$inferInsert>) => db.insert(aiUsage).values({ userId: input.userId, feature: input.feature, model: AI_MODEL, ...v });
  let res: BetaMessage;
  try {
    res = await send({
      model: AI_MODEL,
      max_tokens: input.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: input.effort ?? "medium" },
      system,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
    });
  } catch (e) {
    const message =
      e instanceof Anthropic.AuthenticationError
        ? "The Anthropic API key was refused. Whoever runs the server should check ANTHROPIC_API_KEY."
        : e instanceof Anthropic.RateLimitError
          ? "Claude is busy right now (rate limit). Try again in a minute."
          : e instanceof Anthropic.APIConnectionError
            ? "Could not reach Claude. Check the server's internet connection and try again."
            : e instanceof Anthropic.APIError
              ? `Claude returned an error (${e.status ?? "unknown"}). Try again.`
              : "Something went wrong talking to Claude. Try again.";
    await record({ ok: false, error: message });
    throw new AiError(message);
  }
  const u = res.usage;
  await record({
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    ok: res.stop_reason !== "refusal",
    error: res.stop_reason === "refusal" ? "refused" : null,
  });
  if (res.stop_reason === "refusal") throw new AiError("Claude declined this request. Rephrase it, or do this one by hand.");
  return res;
}

/** The text of a response (all text blocks joined). */
export const textOf = (m: BetaMessage) =>
  m.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/** What the month's AI use cost, by feature, at the model's list price (input $4, output $20, cache read $0.20 per million). */
export async function usageSummary(db: Db, since: Date) {
  const rows = await db.execute<{ feature: string; calls: number; input: number; output: number; cache_read: number; cache_write: number; failed: number }>(sql`
    select feature, count(*)::int as calls, coalesce(sum(input_tokens), 0)::int as input, coalesce(sum(output_tokens), 0)::int as output,
      coalesce(sum(cache_read_tokens), 0)::int as cache_read, coalesce(sum(cache_write_tokens), 0)::int as cache_write,
      count(*) filter (where not ok)::int as failed
    from ai_usage where created_at >= ${since.toISOString()}::timestamptz group by feature order by calls desc`);
  return [...rows].map((r) => {
    const usd = (Number(r.input) * 4 + Number(r.output) * 20 + Number(r.cache_read) * 0.2 + Number(r.cache_write) * 5) / 1_000_000;
    return { feature: String(r.feature), calls: Number(r.calls), input: Number(r.input), output: Number(r.output), failed: Number(r.failed), usd };
  });
}
