import { env } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";

/** Keys whose values are always redacted, in every environment. */
const SECRET_KEYS = new Set([
  "access_token",
  "accesstoken",
  "token",
  "business_token",
  "businesstoken",
  "businesstokenencrypted",
  "client_secret",
  "app_secret",
  "appsecret_proof",
  "code",
  "password",
  "authorization",
  "cookie",
  "set-cookie",
  "verify_token",
  "hub.verify_token",
  "api_key",
  "x-api-key",
]);

/** Keys holding message content; redacted in production. */
const CONTENT_KEYS = new Set(["text", "body", "caption", "reply", "content", "prompt", "messages_text"]);

const MAX_DEPTH = 8;

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: env.isProduction ? undefined : value.stack };
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      // Numeric "code" is a Graph/WhatsApp error code (useful); string "code" is an OAuth code (secret).
      if (key === "code" && typeof v === "number") out[k] = v;
      else if (SECRET_KEYS.has(key)) out[k] = "[redacted]";
      else if (env.isProduction && CONTENT_KEYS.has(key)) out[k] = "[redacted]";
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return scrubString(value);
  return value;
}

/** Strips token-looking substrings from free-form strings (e.g. URLs, error messages). */
function scrubString(s: string): string {
  return s
    .replace(/(access_token|client_secret|code|appsecret_proof|hub\.verify_token)=[^&\s"]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]")
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, "[redacted-token]");
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (level === "debug" && env.isProduction) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: scrubString(msg),
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};

/** Short, safe preview of message text: full text in dev, length only in production. */
export function textPreview(text: string | null | undefined): string {
  if (!text) return "";
  return env.isProduction ? `[${text.length} chars]` : text.slice(0, 200);
}
