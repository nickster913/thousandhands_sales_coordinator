import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * Meta signs every webhook POST: `X-Hub-Signature-256: sha256=` + HMAC-SHA256(rawBody, app secret).
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started/#validating-payloads
 */
export function verifyHubSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const givenHex = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(givenHex)) return false;
  const expected = crypto.createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest();
  const given = Buffer.from(givenHex, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function signHubPayload(rawBody: Buffer | string, secret = env.META_APP_SECRET): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
