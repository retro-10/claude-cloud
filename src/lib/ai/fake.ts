import type Anthropic from "@anthropic-ai/sdk";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/**
 * A stand-in for Claude used only by the browser tests (AI_FAKE=e2e against a crm_e2e* scratch database), so
 * the whole loop (tools, saving, drafts) runs without an API key. Deterministic: with tools it looks up the
 * batches once, then answers from what came back; without tools it returns a short draft.
 */
export function fakeAllowed() {
  if (process.env.AI_FAKE !== "e2e") return false;
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "").startsWith("crm_e2e");
  } catch {
    return false;
  }
}

const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function message(content: BetaMessage["content"], stop_reason: BetaMessage["stop_reason"]): BetaMessage {
  return { id: `msg_fake_${Date.now()}`, type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, usage } as unknown as BetaMessage;
}

export async function fakeCreate(p: Params): Promise<BetaMessage> {
  const last = p.messages[p.messages.length - 1];
  const result = Array.isArray(last.content) ? last.content.find((b) => b.type === "tool_result") : undefined;
  if (result && result.type === "tool_result") {
    const raw = typeof result.content === "string" ? result.content : "";
    let rows: { name?: string; seats?: string; link?: string }[] = [];
    try {
      rows = JSON.parse(raw);
    } catch {
      /* not a list */
    }
    const first = rows[0];
    const text = first ? `There are ${rows.length} batches. The first is [${first.name}](${first.link}) with ${first.seats} seats taken.` : "I found nothing.";
    return message([{ type: "text", text, citations: null }], "end_turn");
  }
  if (p.tools?.some((t) => "name" in t && t.name === "batches"))
    return message([{ type: "tool_use", id: "toolu_fake_1", name: "batches", input: {} }], "tool_use");
  return message([{ type: "text", text: "Hi doctor, thanks for your message! (test draft)", citations: null }], "end_turn");
}
