export type GraphCall = { method: string; path: string; query: Record<string, string>; auth: string | null; body: unknown };
type Handler = (call: GraphCall) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

const realFetch = globalThis.fetch;

/**
 * Replaces global fetch for graph.facebook.com only. Routes are matched on "METHOD /path" with the
 * version prefix stripped, e.g. "POST /123/subscribed_apps". Unmatched Graph calls return 500.
 */
export function installFakeGraph(routes: Record<string, Handler>) {
  const calls: GraphCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname !== "graph.facebook.com") return realFetch(input, init);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const headers = new Headers(init?.headers);
    const call: GraphCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      path,
      query: Object.fromEntries(url.searchParams),
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${path}`];
    const out = handler ? await handler(call) : { status: 500, body: { error: { message: `no fake for ${call.method} ${path}` } } };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

export const WABA_ID = "102290129340398";
export const PHONE_ID = "106540352242922";
export const BUSINESS_TOKEN = "EAAJBtestbusinesstoken1234567890abcdef";
export const CODE = "AQBhlXsctMxJYbwbrpybxlo9tLPGy-test-code";

/** The happy path for a coexistence onboarding, per Meta's documented responses. */
export function happyRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  let sendCount = 0;
  return {
    "GET /oauth/access_token": () => ({ body: { access_token: BUSINESS_TOKEN, token_type: "bearer" } }),
    [`GET /${WABA_ID}/phone_numbers`]: () => ({
      body: { data: [{ id: PHONE_ID, display_phone_number: "+65 8123 4567", verified_name: "Thousand Hands" }] },
    }),
    [`POST /${WABA_ID}/subscribed_apps`]: () => ({ body: { success: true } }),
    [`GET /${PHONE_ID}`]: () => ({ body: { is_on_biz_app: true, platform_type: "CLOUD_API", id: PHONE_ID } }),
    [`POST /${PHONE_ID}/smb_app_data`]: (c) => ({
      body: { messaging_product: "whatsapp", request_id: `req-${(c.body as { sync_type: string }).sync_type}` },
    }),
    [`POST /${PHONE_ID}/messages`]: () => ({
      body: {
        messaging_product: "whatsapp",
        contacts: [{ input: "16505551234", wa_id: "16505551234" }],
        messages: [{ id: `wamid.bot-reply-${++sendCount}` }],
      },
    }),
    ...overrides,
  };
}
