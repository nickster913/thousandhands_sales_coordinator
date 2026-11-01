import { env } from "../config/env";
import { logger } from "../lib/logger";

const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 20_000;

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
    /** True when we never got a response (timeout/network), so Meta may or may not have acted. */
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

type GraphRequest = {
  method: "GET" | "POST";
  /** Path after the version, e.g. `/123/subscribed_apps`. */
  path: string;
  token?: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Short label for logs, e.g. "subscribe_app". */
  op: string;
  timeoutMs?: number;
};

export async function graphRequest<T = Record<string, unknown>>(req: GraphRequest): Promise<T> {
  const url = new URL(`${GRAPH_HOST}/${env.META_GRAPH_VERSION}${req.path}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {};
  if (req.token) headers.Authorization = `Bearer ${req.token}`;
  if (req.body !== undefined) headers["Content-Type"] = "application/json";

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    logger.error("Graph API request failed (no response)", { op: req.op, method: req.method, path: req.path, err });
    throw new GraphError(`Graph ${req.op}: no response (${(err as Error).name})`, 0, undefined, undefined, undefined, true);
  }

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body; keep as text.
  }

  // Path never contains secrets (tokens go in headers, the OAuth code is only in `query`, which isn't logged).
  // Response bodies go through the logger's redaction (access_token etc.).
  const meta = { op: req.op, method: req.method, path: req.path, status: res.status, ms: Date.now() - started, response: data };
  if (res.ok) logger.info("Graph API response", meta);
  else logger.warn("Graph API error response", meta);

  if (!res.ok) {
    const e = (data as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } })?.error;
    throw new GraphError(
      `Graph ${req.op} failed: ${e?.message ?? `HTTP ${res.status}`}`,
      res.status,
      e?.code,
      e?.error_subcode,
      e?.fbtrace_id,
    );
  }
  return data as T;
}

/** GET /oauth/access_token: exchange the Embedded Signup code for a business token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const data = await graphRequest<{ access_token?: string }>({
    op: "exchange_code",
    method: "GET",
    path: "/oauth/access_token",
    query: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code },
  });
  if (!data.access_token) throw new GraphError("Graph exchange_code: no access_token in response", 200);
  return data.access_token;
}

export type PhoneNumber = { id: string; display_phone_number?: string; verified_name?: string };

/** GET /{waba_id}/phone_numbers — Cloud API edge on the Messaging account (still addressed as waba_id). */
export async function getPhoneNumbers(wabaId: string, token: string): Promise<PhoneNumber[]> {
  const data = await graphRequest<{ data?: PhoneNumber[] }>({
    op: "get_phone_numbers",
    method: "GET",
    path: `/${encodeURIComponent(wabaId)}/phone_numbers`,
    token,
  });
  return data.data ?? [];
}

/** POST /{waba_id}/subscribed_apps */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  const data = await graphRequest<{ success?: boolean }>({
    op: "subscribe_app",
    method: "POST",
    path: `/${encodeURIComponent(wabaId)}/subscribed_apps`,
    token,
  });
  if (data.success !== true) throw new GraphError("Graph subscribe_app: success was not true", 200);
}

/** GET /{phone_number_id}?fields=is_on_biz_app,platform_type */
export async function getCoexistenceStatus(
  phoneNumberId: string,
  token: string,
): Promise<{ is_on_biz_app?: boolean; platform_type?: string }> {
  return graphRequest({
    op: "check_coexistence",
    method: "GET",
    path: `/${encodeURIComponent(phoneNumberId)}`,
    query: { fields: "is_on_biz_app,platform_type" },
    token,
  });
}

export type SmbSyncType = "smb_app_state_sync" | "history";

/** POST /{phone_number_id}/smb_app_data. Meta accepts each sync_type once per onboarding. */
export async function requestSmbAppData(phoneNumberId: string, token: string, syncType: SmbSyncType): Promise<string> {
  const data = await graphRequest<{ request_id?: string }>({
    op: `smb_app_data:${syncType}`,
    method: "POST",
    path: `/${encodeURIComponent(phoneNumberId)}/smb_app_data`,
    token,
    body: { messaging_product: "whatsapp", sync_type: syncType },
  });
  if (!data.request_id) throw new GraphError(`Graph smb_app_data:${syncType}: no request_id in response`, 200);
  return data.request_id;
}
