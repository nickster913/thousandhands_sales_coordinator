export type AnthropicCall = { body: unknown; apiKey: string | null };

/**
 * Intercepts api.anthropic.com. Compose after installFakeGraph so Graph still hits the Graph fake
 * (this wrapper calls the current global fetch for every other host).
 */
export function installFakeAnthropic(text = "How many cartons of item A would you like?", hold?: () => Promise<void>) {
  const inner = globalThis.fetch;
  const calls: AnthropicCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname !== "api.anthropic.com") return inner(input, init);
    const headers = new Headers(init?.headers);
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      apiKey: headers.get("x-api-key"),
    });
    if (hold) await hold();
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: text ? [{ type: "text", text }] : [],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 9 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = inner;
    },
  };
}
