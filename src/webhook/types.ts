/** Loose shapes for WhatsApp Cloud API webhook payloads (Graph v26.0). Extra fields are ignored. */

export type Json = Record<string, unknown>;

export type WebhookEnvelope = {
  object?: string;
  entry?: WebhookEntry[];
};

export type WebhookEntry = {
  id?: string;
  time?: number;
  changes?: WebhookChange[];
};

export type WebhookChange = {
  field?: string;
  value?: Json;
};

export type WaMessage = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string; id?: string };
  video?: { caption?: string; id?: string };
  document?: { caption?: string; id?: string; filename?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number };
  errors?: { code?: number; title?: string }[];
  edit?: { original_message_id?: string; message?: WaMessage };
  revoke?: { original_message_id?: string };
  history_context?: { status?: string };
};

export type WaStatus = {
  id?: string;
  status?: string;
  timestamp?: string | number;
  recipient_id?: string;
  errors?: { code?: number; title?: string }[];
};

export type WaContact = {
  wa_id?: string;
  profile?: { name?: string };
};

export function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function messageText(msg: WaMessage | undefined): string | null {
  if (!msg) return null;
  const t =
    msg.text?.body ??
    msg.image?.caption ??
    msg.video?.caption ??
    msg.document?.caption ??
    null;
  return t ?? null;
}

export function unixToDate(value: unknown): Date {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n * 1000);
}
