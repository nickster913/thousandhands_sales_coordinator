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

/** Free-form Cloud API replies are only allowed inside this window after the customer's last message. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Messages from one chat inside this gap are answered together. */
export const BURST_WAIT_MS = 3_000;

export type InboundOrderMessage = {
  wamid: string;
  contactPhone: string;
  type: string;
  created: boolean;
};

type Slot = {
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  /** Bumped on every new inbound so an in-flight reply can tell it is stale. */
  epoch: number;
};

const slots = new Map<string, Slot>();

function pauseMs(): number {
  return env.TAKEOVER_PAUSE_HOURS * 60 * 60 * 1000;
}

function stillPaused(at: Date | null | undefined, now: Date): boolean {
  if (!at) return false;
  return now.getTime() - at.getTime() < pauseMs();
}

function windowOpen(lastCustomerMessageAt: Date | null | undefined, now = Date.now()): boolean {
  if (!lastCustomerMessageAt) return false;
  return now - lastCustomerMessageAt.getTime() <= CUSTOMER_SERVICE_WINDOW_MS;
}

function slotFor(phone: string): Slot {
  let slot = slots.get(phone);
  if (!slot) {
    slot = { timer: null, running: null, epoch: 0 };
    slots.set(phone, slot);
  }
  return slot;
}

function skip(reason: string, wamid?: string) {
  logger.info("Skipping AI reply", { ...(wamid ? { wamid } : {}), reason });
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
 * Reload the chat and refuse to send if the customer window closed, AI was turned off,
 * the phone took over, or a newer message arrived while we were thinking.
 */
async function stillAllowed(phone: string, epoch: number, wamid: string): Promise<boolean> {
  const slot = slots.get(phone);
  if (!slot || slot.epoch !== epoch || slot.timer) {
    skip("newer_messages", wamid);
    return false;
  }
  const chat = await prisma.chatState.findUnique({ where: { contactPhone: phone } });
  const now = new Date();
  if (!windowOpen(chat?.lastCustomerMessageAt, now.getTime())) {
    skip("outside_service_window", wamid);
    return false;
  }
  if (chat?.aiEnabled === false) {
    skip("ai_disabled", wamid);
    return false;
  }
  if (chat && stillPaused(chat.humanTakeoverAt, now)) {
    skip("takeover_pause", wamid);
    return false;
  }
  return true;
}

function arm(phone: string) {
  const slot = slotFor(phone);
  if (slot.timer) clearTimeout(slot.timer);
  const epoch = ++slot.epoch;
  const timer = setTimeout(() => {
    const current = slots.get(phone);
    if (current?.timer === timer) current.timer = null;
    void start(phone, epoch);
  }, BURST_WAIT_MS);
  timer.unref?.();
  slot.timer = timer;
}

async function start(phone: string, epoch: number): Promise<void> {
  const slot = slots.get(phone);
  if (!slot || slot.epoch !== epoch) return;
  if (slot.running) {
    await slot.running;
    if (slot.epoch !== epoch || slot.timer) return;
  }
  const job = reply(phone, epoch)
    .catch((err) => logger.error("AI reply failed", { err }))
    .finally(() => {
      if (slot.running === job) slot.running = null;
    });
  slot.running = job;
  await job;
}

async function reply(phone: string, epoch: number): Promise<void> {
  const now = new Date();
  const chat = await prisma.chatState.findUnique({ where: { contactPhone: phone } });
  if (!windowOpen(chat?.lastCustomerMessageAt, now.getTime())) {
    skip("outside_service_window");
    return;
  }
  if (chat?.aiEnabled === false) {
    skip("ai_disabled");
    return;
  }
  if (chat && stillPaused(chat.humanTakeoverAt, now)) {
    skip("takeover_pause");
    return;
  }

  const lastOut = await prisma.message.findFirst({
    where: { contactPhone: phone, fromMe: true },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const pending = await prisma.message.findMany({
    where: {
      contactPhone: phone,
      direction: "in",
      revoked: false,
      ...(lastOut ? { createdAt: { gt: lastOut.createdAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { wamid: true, type: true },
  });
  if (pending.length === 0) return;

  const latest = pending[pending.length - 1]!;
  const hasText = pending.some((m) => m.type === "text");

  if (!hasText) {
    if (chat && stillPaused(chat.lastFallbackSentAt, now)) {
      skip("fallback_cooldown", latest.wamid);
      return;
    }
    if (!(await stillAllowed(phone, epoch, latest.wamid))) return;
    await sendAndStore({ contactPhone: phone, body: nonTextFallback(), replyToWamid: latest.wamid });
    await prisma.chatState.upsert({
      where: { contactPhone: phone },
      create: { contactPhone: phone, lastFallbackSentAt: new Date(), aiEnabled: true },
      update: { lastFallbackSentAt: new Date() },
    });
    return;
  }

  const rows = await prisma.message.findMany({
    where: { contactPhone: phone, revoked: false },
    orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
    take: HISTORY_LIMIT,
    select: { fromMe: true, type: true, text: true },
  });
  const turns = messagesToTurns(rows.reverse());
  if (turns.length === 0 || turns[turns.length - 1]?.role !== "user") {
    skip("empty_turns", latest.wamid);
    return;
  }

  const text = await completeReply(turns);
  if (!text) {
    logger.warn("Claude returned an empty reply", { wamid: latest.wamid });
    return;
  }
  if (!(await stillAllowed(phone, epoch, latest.wamid))) return;
  await sendAndStore({ contactPhone: phone, body: text, replyToWamid: latest.wamid });
}

/**
 * Called after an inbound customer message is persisted.
 * Returns as soon as the chat is queued so webhook processing is not blocked for the burst wait or the Claude call.
 */
export async function onInboundCustomerMessage(msg: InboundOrderMessage): Promise<void> {
  if (!msg.created) return;
  const contactPhone = digits(msg.contactPhone);
  if (!contactPhone) return;
  try {
    const account = await getAccount();
    if (account.status !== "connected" || !account.phoneNumberId || !account.businessTokenEncrypted) {
      skip("not_connected", msg.wamid);
      return;
    }
    const chat = await prisma.chatState.findUnique({ where: { contactPhone } });
    if (!windowOpen(chat?.lastCustomerMessageAt)) {
      skip("outside_service_window", msg.wamid);
      return;
    }
    if (chat?.aiEnabled === false) {
      skip("ai_disabled", msg.wamid);
      return;
    }
    if (chat && stillPaused(chat.humanTakeoverAt, new Date())) {
      skip("takeover_pause", msg.wamid);
      return;
    }
    arm(contactPhone);
  } catch (err) {
    logger.error("AI reply failed", { wamid: msg.wamid, err });
  }
}

/** Runs any burst timers immediately and waits until in-flight replies finish. Used by tests. */
export async function flushPendingReplies(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const due: Promise<void>[] = [];
    for (const [phone, slot] of slots) {
      if (!slot.timer) continue;
      clearTimeout(slot.timer);
      slot.timer = null;
      due.push(start(phone, slot.epoch));
    }
    if (due.length > 0) {
      await Promise.all(due);
      continue;
    }
    const running = [...slots.values()].map((s) => s.running).filter((p): p is Promise<void> => p !== null);
    if (running.length === 0) return;
    await Promise.all(running);
  }
}
