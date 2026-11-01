import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { enqueue, queueIdle } from "../lib/queue";
import { handleAccountUpdate } from "./handlers/accountUpdate";
import { handleMessageEchoes } from "./handlers/echoes";
import { handleHistory } from "./handlers/history";
import { handleMessages } from "./handlers/messages";
import { handleStateSync } from "./handlers/stateSync";
import { asArray, asRecord } from "./types";
import type { WebhookChange, WebhookEntry, WebhookEnvelope } from "./types";

const STALE_CLAIM_MS = 5 * 60 * 1000;

export function enqueueWebhookEvent(id: number): void {
  enqueue(() => processEventById(id));
}

export function flushWebhookQueue(): Promise<void> {
  return queueIdle();
}

export async function replayUnprocessed(limit = 200): Promise<number> {
  const rows = await prisma.webhookEvent.findMany({
    where: { processed: false },
    select: { id: true },
    orderBy: { id: "asc" },
    take: limit,
  });
  for (const row of rows) enqueueWebhookEvent(row.id);
  if (rows.length) logger.info("Replaying unprocessed webhook events", { count: rows.length });
  return rows.length;
}

/**
 * Atomic claim so two Railway instances (or a replay overlapping a live worker)
 * cannot process the same row. Idempotent handlers still protect against Meta retries.
 */
export async function processEventById(id: number): Promise<void> {
  const now = new Date();
  const claimed = await prisma.webhookEvent.updateMany({
    where: {
      id,
      processed: false,
      OR: [{ processingAt: null }, { processingAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { processingAt: now },
  });
  if (claimed.count !== 1) return;

  const row = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!row) return;

  try {
    await processPayload(row.rawJson);
    await prisma.webhookEvent.update({
      where: { id },
      data: { processed: true, processingAt: null, error: null },
    });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    logger.error("Webhook processing failed", { id, err });
    await prisma.webhookEvent.update({
      where: { id },
      data: { processed: false, processingAt: null, error: message.slice(0, 2000) },
    });
  }
}

export async function processPayload(raw: unknown): Promise<void> {
  const envelope = asRecord(raw) as WebhookEnvelope;
  for (const entry of asArray<WebhookEntry>(envelope.entry)) {
    for (const change of asArray<WebhookChange>(entry.changes)) {
      const field = change.field ?? "";
      const value = asRecord(change.value);
      switch (field) {
        case "messages":
          await handleMessages(value);
          break;
        case "smb_message_echoes":
          await handleMessageEchoes(value);
          break;
        case "history":
          await handleHistory(value);
          break;
        case "smb_app_state_sync":
          await handleStateSync(value);
          break;
        case "account_update":
          await handleAccountUpdate(value);
          break;
        default:
          logger.info("Ignoring unhandled webhook field", { field: field || "(none)" });
      }
    }
  }
}

export function fieldsInPayload(raw: unknown): string {
  const envelope = asRecord(raw) as WebhookEnvelope;
  const fields = new Set<string>();
  for (const entry of asArray<WebhookEntry>(envelope.entry)) {
    for (const change of asArray<WebhookChange>(entry.changes)) {
      if (change.field) fields.add(change.field);
    }
  }
  return [...fields].sort().join(",");
}
