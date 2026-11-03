import { env } from "../config/env";
import { logger } from "../lib/logger";
import type { ChatTurn } from "./conversation";
import { systemPrompt } from "./prompt";

const ANTHROPIC_HOST = "https://api.anthropic.com";
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = 1024;

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClaudeError";
  }
}

type AnthropicResponse = {
  id?: string;
  stop_reason?: string;
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

/** One non-streaming Messages API call. Empty or whitespace replies become null. */
export async function completeReply(turns: ChatTurn[]): Promise<string | null> {
  if (turns.length === 0 || turns[turns.length - 1]?.role !== "user") {
    throw new ClaudeError("completeReply requires turns ending in a user message", 0);
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${ANTHROPIC_HOST}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(),
        messages: turns,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error("Anthropic request failed (no response)", { err });
    throw new ClaudeError(`Anthropic: no response (${(err as Error).name})`, 0);
  }

  const data = (await res.json().catch(() => ({}))) as AnthropicResponse;
  logger.info("Anthropic response", {
    status: res.status,
    ms: Date.now() - started,
    model: env.AI_MODEL,
    id: data.id,
    stopReason: data.stop_reason,
    usage: data.usage,
  });

  if (!res.ok) {
    throw new ClaudeError(`Anthropic failed: ${data.error?.message ?? `HTTP ${res.status}`}`, res.status);
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || null;
}
