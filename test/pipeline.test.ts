import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/db";
import { nonTextFallback } from "../src/ai/prompt";
import { signHubPayload } from "../src/webhook/signature";
import { flushWebhookQueue } from "../src/webhook/processor";
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
});

async function postWebhook(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  return fetch(`${app.base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signHubPayload(body) },
    body,
  });
}

function installReplyFakes(text = AI_REPLY) {
  const graph = installFakeGraph(happyRoutes());
  const anthropic = installFakeAnthropic(text);
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
    await flushWebhookQueue();
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
    await postWebhook(inboundText);
    await flushWebhookQueue();

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
    await postWebhook(inboundText);
    await postWebhook(inboundText);
    await flushWebhookQueue();
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
    await postWebhook(inboundText);
    await flushWebhookQueue();
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
    await postWebhook(inboundText);
    await flushWebhookQueue();
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
    await postWebhook(inboundImage);
    await flushWebhookQueue();
    assert.equal(fakes.anthropicCalls.length, 0);
    const firstSends = fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`);
    assert.equal(firstSends.length, 1);
    assert.equal((firstSends[0]!.body as { text: { body: string } }).text.body, nonTextFallback());
    const chat = await prisma.chatState.findUnique({ where: { contactPhone: CUSTOMER } });
    assert.ok(chat?.lastFallbackSentAt);

    const again = structuredClone(inboundImage) as typeof inboundImage;
    (again.entry![0]!.changes![0]!.value as { messages: { id: string }[] }).messages[0]!.id = "wamid.image-2";
    await postWebhook(again);
    await flushWebhookQueue();
    assert.equal(fakes.graphCalls.filter((c) => c.path === `/${PHONE_ID}/messages`).length, 1);
  } finally {
    fakes.restore();
  }
});
