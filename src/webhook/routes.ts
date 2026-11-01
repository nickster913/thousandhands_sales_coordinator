import { Router } from "express";
import { prisma } from "../lib/db";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { safeEqual } from "../lib/crypto";
import { enqueueWebhookEvent, fieldsInPayload } from "./processor";
import { verifyHubSignature } from "./signature";

export const webhookRouter = Router();

function hubParam(query: Record<string, unknown>, name: string): string {
  const nested = query.hub;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const v = (nested as Record<string, unknown>)[name];
    if (typeof v === "string") return v;
  }
  const flat = query[`hub.${name}`];
  return typeof flat === "string" ? flat : "";
}

/**
 * GET /webhook — Meta's verify-token handshake.
 * Return hub.challenge as plain text when hub.mode=subscribe and the token matches.
 */
webhookRouter.get("/webhook", (req, res) => {
  const mode = hubParam(req.query as Record<string, unknown>, "mode");
  const token = hubParam(req.query as Record<string, unknown>, "verify_token");
  const challenge = hubParam(req.query as Record<string, unknown>, "challenge");
  if (mode === "subscribe" && token && safeEqual(token, env.WEBHOOK_VERIFY_TOKEN)) {
    return res.status(200).type("text/plain").send(challenge);
  }
  logger.warn("Webhook verification rejected");
  res.status(403).type("text/plain").send("forbidden");
});

/**
 * POST /webhook — verify signature on the raw body, persist, 200, process later.
 * Never lets handler work (or the order pipeline) delay the response.
 */
webhookRouter.post("/webhook", async (req, res) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
  const header = req.header("x-hub-signature-256") ?? req.header("X-Hub-Signature-256");
  if (!verifyHubSignature(raw, header)) {
    logger.warn("Webhook signature rejected");
    return res.status(401).type("text/plain").send("invalid signature");
  }

  let parsed: unknown = {};
  try {
    parsed = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    parsed = { _unparsed: true };
  }

  const row = await prisma.webhookEvent.create({
    data: { field: fieldsInPayload(parsed) || null, rawJson: parsed as object, processed: false },
  });

  res.status(200).type("text/plain").send("ok");
  enqueueWebhookEvent(row.id);
});
