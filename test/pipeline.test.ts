import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/db";
import { nonTextFallback } from "../src/ai/prompt";
import { signHubPayload } from "../src/webhook/signature";
import { flushWebhookQueue } from "../src/webhook/processor";
import { BURST_WAIT_MS, CUSTOMER_SERVICE_WINDOW_MS, flushPendingReplies } from "../src/orders/pipeline";
import { dbAvailable, resetDb } from "./db";
import { installFakeAnthropic } from "./fakeAnthropic";
import { BUSINESS_TOKEN, happyRoutes, installFakeGraph, PHONE_ID } from "./fakeGraph";
import { CUSTOMER, inboundImage, inboundText, smbEcho, TEXT_WAMID } from "./fixtures/webhooks";
import { seedConnectedAccount, startApp } from "./helpers";

const AI_REPLY = "Sure — 20 cartons of item A. Delivery where?";

let skip = false;
let app: Awaited<ReturnType<typeof startApp>>;

before(async () => {
  skip = !(await dbAvailable());
  app = await startApp();
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  if (!skip) await resetDb();
});
afterEach(async () => {
  await flushWebhookQueue();
  await flushPendingReplies();
});

function fresh<T>(payload: T): T {
  const copy = structuredClone(payload) as T & {
    entry?: { changes?: { value?: { messages?: { timestamp?: string }[] } }[] }[];
  };
  const now = String(Math.floor(Date.now() / 1000));
  for (const message of copy.entry?.[0]?.changes?.[0]?.value?.messages ?? []) message.timestamp = now;
  return copy;
}

async function settle() {
  await flushWebhookQueue();
  await flushPendingReplies();
}

async function waitFor(pred: () => boolean) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 2000) throw new Error("timed out waiting for Claude");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function postWebhook(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  return fetch(`${app.base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signHubPayload(body) },
    body,
  });
}

function installReplyFakes(text = AI_REPLY, hold?: () => Promise<void>) {
  const graph = installFakeGraph(happyRoutes());
  const anthropic = installFakeAnthropic(text, hold);
  return {
    graphCalls: graph.calls,
    anthropicCalls: anthropic.calls,
    restore() {
      anthropic.restore();
      graph.restore();
    },
  };
}

test("inbound text is not sent to Claude when WhatsApp is not connected", async (t) => {
  if (skip) return t.skip();
  const fakes = installReplyFakes();
  try {
    await postWebhook(inboundText);
    await settle();
    assert.equal(await prisma.message.count(), 1);
    assert.equal(await prisma.message.count({ where: { direction: "out_bot" } }), 0);
    assert.equal(fakes.anthropicCalls.length, 0);
    assert.equal(fakes.graphCalls.filter((c) => c.path.endsWith("/messages")).length, 0);
  } finally {
    fakes.restore();
  }
});

test("inbound text calls Claude and sends the reply via Cloud API", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    await postWebhook(fresh(inboundText));
    await settle();

    assert.equal(fakes.anthropicCalls.length, 1);
    const req = fakes.anthropicCalls[0]!.body as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
    };
    assert.equal(req.model, "claude-sonnet-5-5");
    assert.match(req.system, /Thousand Hands Test Pte Ltd/);
    assert.equal(req.messages.at(-1)?.role, "user");
    assert.match(req.messages.at(-1)?.content ?? "", /20 ctn item A please/);
    assert.equal(fakes.anthropicCalls[0]!.apiKey, process.env.ANTHROPIC_API_KEY);

    const sends = fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`);
    assert.equal(sends.length, 1);
    assert.equal(sends[0]!.auth, `Bearer ${BUSINESS_TOKEN}`);
    const sendBody = sends[0]!.body as {
      to: string;
      type: string;
      text: { body: string };
      context: { message_id: string };
    };
    assert.equal(sendBody.to, CUSTOMER);
    assert.equal(sendBody.type, "text");
    assert.equal(sendBody.text.body, AI_REPLY);
    assert.equal(sendBody.context.message_id, TEXT_WAMID);

    const bot = await prisma.message.findFirst({ where: { direction: "out_bot" } });
    assert.ok(bot);
    assert.equal(bot.fromMe, true);
    assert.equal(bot.contactPhone, CUSTOMER);
    assert.equal(bot.text, AI_REPLY);
    assert.equal(bot.wamid, "wamid.bot-reply-1");
  } finally {
    fakes.restore();
  }
});

test("the same inbound wamid does not send a second reply", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    await postWebhook(fresh(inboundText));
    await postWebhook(fresh(inboundText));
    await settle();
    assert.equal(fakes.anthropicCalls.length, 1);
    assert.equal(await prisma.message.count({ where: { direction: "out_bot" } }), 1);
  } finally {
    fakes.restore();
  }
});

test("a human echo pauses AI replies", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    await postWebhook(smbEcho);
    await postWebhook(fresh(inboundText));
    await settle();
    assert.equal(fakes.anthropicCalls.length, 0);
    assert.equal(await prisma.message.count({ where: { direction: "out_bot" } }), 0);
    assert.equal(await prisma.message.count({ where: { direction: "out_human" } }), 1);
  } finally {
    fakes.restore();
  }
});

test("aiEnabled=false skips Claude even when connected", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  await prisma.chatState.create({ data: { contactPhone: CUSTOMER, aiEnabled: false } });
  const fakes = installReplyFakes();
  try {
    await postWebhook(fresh(inboundText));
    await settle();
    assert.equal(fakes.anthropicCalls.length, 0);
    assert.equal(await prisma.message.count({ where: { direction: "out_bot" } }), 0);
  } finally {
    fakes.restore();
  }
});

test("non-text inbound gets a fallback once per pause window, not a Claude call", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    await postWebhook(fresh(inboundImage));
    await settle();
    assert.equal(fakes.anthropicCalls.length, 0);
    const firstSends = fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`);
    assert.equal(firstSends.length, 1);
    assert.equal((firstSends[0]!.body as { text: { body: string } }).text.body, nonTextFallback());
    const chat = await prisma.chatState.findUnique({ where: { contactPhone: CUSTOMER } });
    assert.ok(chat?.lastFallbackSentAt);

    const again = structuredClone(inboundImage) as typeof inboundImage;
    (again.entry![0]!.changes![0]!.value as { messages: { id: string }[] }).messages[0]!.id = "wamid.image-2";
    await postWebhook(fresh(again));
    await settle();
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 1);
  } finally {
    fakes.restore();
  }
});

test("burst wait is 3 seconds and the service window is 24 hours", () => {
  assert.equal(BURST_WAIT_MS, 3_000);
  assert.equal(CUSTOMER_SERVICE_WINDOW_MS, 24 * 60 * 60 * 1000);
});

test("a message older than 24 hours is stored and not answered", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    const old = structuredClone(inboundText);
    const message = (old.entry![0]!.changes![0]!.value as { messages: { timestamp: string }[] }).messages[0]!;
    message.timestamp = String(Math.floor((Date.now() - CUSTOMER_SERVICE_WINDOW_MS - 60_000) / 1000));
    await postWebhook(old);
    await settle();
    assert.equal(await prisma.message.count({ where: { direction: "in" } }), 1);
    assert.equal(fakes.anthropicCalls.length, 0);
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 0);
  } finally {
    fakes.restore();
  }
});

test("several texts in one burst become a single reply", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    const second = fresh(inboundText);
    const message = (second.entry![0]!.changes![0]!.value as { messages: { id: string; text: { body: string } }[] }).messages[0]!;
    message.id = "wamid.text-2";
    message.text.body = "and 5 drum B";
    await postWebhook(fresh(inboundText));
    await postWebhook(second);
    await settle();
    assert.equal(fakes.anthropicCalls.length, 1);
    const content = (fakes.anthropicCalls[0]!.body as { messages: { content: string }[] }).messages.at(-1)?.content ?? "";
    assert.match(content, /20 ctn item A please/);
    assert.match(content, /5 drum B/);
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 1);
  } finally {
    fakes.restore();
  }
});

test("a text plus a photo in one burst gets one Claude reply and no fallback", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  const fakes = installReplyFakes();
  try {
    await postWebhook(fresh(inboundText));
    await postWebhook(fresh(inboundImage));
    await settle();
    assert.equal(fakes.anthropicCalls.length, 1);
    const content = (fakes.anthropicCalls[0]!.body as { messages: { content: string }[] }).messages.at(-1)?.content ?? "";
    assert.match(content, /\[image\]/);
    const sends = fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`);
    assert.equal(sends.length, 1);
    assert.equal((sends[0]!.body as { text: { body: string } }).text.body, AI_REPLY);
  } finally {
    fakes.restore();
  }
});

test("a phone takeover while Claude is thinking discards the reply", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fakes = installReplyFakes(AI_REPLY, () => hold);
  try {
    await postWebhook(fresh(inboundText));
    await flushWebhookQueue();
    const done = flushPendingReplies();
    await waitFor(() => fakes.anthropicCalls.length === 1);
    await prisma.chatState.update({ where: { contactPhone: CUSTOMER }, data: { humanTakeoverAt: new Date() } });
    release();
    await done;
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 0);
    assert.equal(await prisma.message.count({ where: { direction: "out_bot" } }), 0);
  } finally {
    release();
    fakes.restore();
  }
});

test("a message that arrives while Claude is thinking is included in one later reply", async (t) => {
  if (skip) return t.skip();
  await seedConnectedAccount();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fakes = installReplyFakes(AI_REPLY, () => hold);
  try {
    await postWebhook(fresh(inboundText));
    await flushWebhookQueue();
    const done = flushPendingReplies();
    await waitFor(() => fakes.anthropicCalls.length === 1);
    const second = fresh(inboundText);
    const message = (second.entry![0]!.changes![0]!.value as { messages: { id: string; text: { body: string } }[] }).messages[0]!;
    message.id = "wamid.text-2";
    message.text.body = "and 5 drum B";
    await postWebhook(second);
    await flushWebhookQueue();
    release();
    await done;
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 1);
    assert.equal(fakes.anthropicCalls.length, 2);
    const content = (fakes.anthropicCalls[1]!.body as { messages: { content: string }[] }).messages.at(-1)?.content ?? "";
    assert.match(content, /20 ctn item A please/);
    assert.match(content, /5 drum B/);
  } finally {
    release();
    fakes.restore();
  }
});
