import { env } from "../config/env";
import { completeReply } from "../ai/claude";
import { messagesToTurns } from "../ai/conversation";
import { nonTextFallback } from "../ai/prompt";
import { logger } from "../lib/logger";
import { prisma } from "../lib/db";
import { digits } from "../lib/phone";
import { upsertMessage } from "../webhook/store";
import { getAccount } from "../whatsapp/account";
import { sendTextMessage } from "../whatsapp/send";

const HISTORY_LIMIT = 20;

export type InboundOrderMessage = {
  wamid: string;
  contactPhone: string;
  type: string;
  created: boolean;
};

function pauseMs(): number {
  return env.TAKEOVER_PAUSE_HOURS * 60 * 60 * 1000;
}

function stillPaused(at: Date | null | undefined, now: Date): boolean {
  if (!at) return false;
  return now.getTime() - at.getTime() < pauseMs();
}

async function sendAndStore(opts: { contactPhone: string; body: string; replyToWamid: string }): Promise<void> {
  const sent = await sendTextMessage({
    to: opts.contactPhone,
    body: opts.body,
    replyToWamid: opts.replyToWamid,
  });
  await upsertMessage({
    wamid: sent.wamid,
    contactPhone: opts.contactPhone,
    direction: "out_bot",
    fromMe: true,
    type: "text",
    text: sent.body,
    raw: { source: "ai", replyTo: opts.replyToWamid },
    timestamp: new Date(),
    status: "sent",
  });
  logger.info("AI reply sent", { inboundWamid: opts.replyToWamid, replyWamid: sent.wamid });
}

/**
 * Called after an inbound customer message is persisted (not edits, revokes, unsupported, echoes, or history).
 * Errors are logged here so a failed Claude/Graph call cannot un-process the webhook (which would skip AI on replay
 * because the inbound wamid already exists).
 */
export async function onInboundCustomerMessage(msg: InboundOrderMessage): Promise<void> {
  if (!msg.created) return;
  try {
    await replyToInbound(msg);
  } catch (err) {
    logger.error("AI reply failed", { wamid: msg.wamid, err });
  }
}

async function replyToInbound(msg: InboundOrderMessage): Promise<void> {
  const contactPhone = digits(msg.contactPhone);
  const now = new Date();

  const account = await getAccount();
  if (account.status !== "connected" || !account.phoneNumberId || !account.businessTokenEncrypted) {
    logger.info("Skipping AI reply", { wamid: msg.wamid, reason: "not_connected" });
    return;
  }

  const chat = await prisma.chatState.findUnique({ where: { contactPhone } });
  if (chat && chat.aiEnabled === false) {
    logger.info("Skipping AI reply", { wamid: msg.wamid, reason: "ai_disabled" });
    return;
  }
  if (chat && stillPaused(chat.humanTakeoverAt, now)) {
    logger.info("Skipping AI reply", { wamid: msg.wamid, reason: "takeover_pause" });
    return;
  }

  if (msg.type !== "text") {
    if (chat && stillPaused(chat.lastFallbackSentAt, now)) {
      logger.info("Skipping AI reply", { wamid: msg.wamid, reason: "fallback_cooldown" });
      return;
    }
    await sendAndStore({ contactPhone, body: nonTextFallback(), replyToWamid: msg.wamid });
    await prisma.chatState.upsert({
      where: { contactPhone },
      create: { contactPhone, lastFallbackSentAt: now, aiEnabled: true },
      update: { lastFallbackSentAt: now },
    });
    return;
  }

  const rows = await prisma.message.findMany({
    where: { contactPhone, revoked: false },
    orderBy: { timestamp: "desc" },
    take: HISTORY_LIMIT,
    select: { fromMe: true, type: true, text: true },
  });
  const turns = messagesToTurns(rows.reverse());
  if (turns.length === 0) {
    logger.info("Skipping AI reply", { wamid: msg.wamid, reason: "empty_turns" });
    return;
  }

  const reply = await completeReply(turns);
  if (!reply) {
    logger.warn("Claude returned an empty reply", { wamid: msg.wamid });
    return;
  }
  await sendAndStore({ contactPhone, body: reply, replyToWamid: msg.wamid });
}
