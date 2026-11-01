import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { signHubPayload } from "../src/webhook/signature";
import { flushWebhookQueue, processEventById, replayUnprocessed } from "../src/webhook/processor";
import { ACCOUNT_ID, getAccount } from "../src/whatsapp/account";
import { dbAvailable, resetDb } from "./db";
import { startApp } from "./helpers";
import {
  CUSTOMER,
  ECHO_WAMID,
  HISTORY_WAMID,
  PLACEHOLDER_WAMID,
  STATUS_WAMID,
  TEXT_WAMID,
  accountOffboarded,
  accountReconnected,
  contactsAdd,
  contactsRemove,
  deliveredStatus,
  historyChunk,
  historyDeclined,
  historyMediaFollowup,
  inboundEdit,
  inboundImage,
  inboundRevoke,
  inboundText,
  inboundUnsupported,
  partnerRemoved,
  smbEcho,
} from "./fixtures/webhooks";

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

test("POST /webhook returns 200 before processing and persists the inbound message", async (t) => {
  if (skip) return t.skip();
  const started = Date.now();
  const r = await postWebhook(inboundText);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
  assert.ok(Date.now() - started < 250, "handler must not wait for processing");
  assert.equal(await prisma.message.count(), 0);
  await flushWebhookQueue();
  const msg = await prisma.message.findUnique({ where: { wamid: TEXT_WAMID } });
  assert.ok(msg);
  assert.equal(msg.direction, "in");
  assert.equal(msg.fromMe, false);
  assert.equal(msg.contactPhone, CUSTOMER);
  assert.equal(msg.type, "text");
  const contact = await prisma.contact.findUnique({ where: { phoneNumber: CUSTOMER } });
  assert.equal(contact?.profileName, "Sheena Nelson");
  const chat = await prisma.chatState.findUnique({ where: { contactPhone: CUSTOMER } });
  assert.ok(chat?.lastCustomerMessageAt);
});

test("the same wamid is stored once (Meta retries / replay)", async (t) => {
  if (skip) return t.skip();
  await postWebhook(inboundText);
  await postWebhook(inboundText);
  await flushWebhookQueue();
  assert.equal(await prisma.message.count({ where: { wamid: TEXT_WAMID } }), 1);
  assert.equal(await prisma.webhookEvent.count(), 2);
  assert.equal(await prisma.webhookEvent.count({ where: { processed: true } }), 2);
});

test("statuses[] updates delivery status and does not go backwards", async (t) => {
  if (skip) return t.skip();
  await prisma.message.create({
    data: {
      wamid: STATUS_WAMID,
      contactPhone: CUSTOMER,
      direction: "out_bot",
      fromMe: true,
      type: "text",
      text: "draft sent",
      rawJson: {},
      timestamp: new Date(),
      status: "sent",
    },
  });
  await postWebhook(deliveredStatus);
  await flushWebhookQueue();
  assert.equal((await prisma.message.findUnique({ where: { wamid: STATUS_WAMID } }))?.status, "delivered");

  const read = structuredClone(deliveredStatus);
  (read.entry![0]!.changes![0]!.value as { statuses: { status: string }[] }).statuses[0]!.status = "read";
  await postWebhook(read);
  await flushWebhookQueue();
  assert.equal((await prisma.message.findUnique({ where: { wamid: STATUS_WAMID } }))?.status, "read");

  const sentAgain = structuredClone(deliveredStatus);
  (sentAgain.entry![0]!.changes![0]!.value as { statuses: { status: string }[] }).statuses[0]!.status = "sent";
  await postWebhook(sentAgain);
  await flushWebhookQueue();
  assert.equal((await prisma.message.findUnique({ where: { wamid: STATUS_WAMID } }))?.status, "read");
});

test("smb_message_echoes saves fromMe and starts the takeover pause", async (t) => {
  if (skip) return t.skip();
  const before = Date.now();
  await postWebhook(smbEcho);
  await flushWebhookQueue();
  const msg = await prisma.message.findUnique({ where: { wamid: ECHO_WAMID } });
  assert.equal(msg?.direction, "out_human");
  assert.equal(msg?.fromMe, true);
  assert.equal(msg?.contactPhone, CUSTOMER);
  const chat = await prisma.chatState.findUnique({ where: { contactPhone: CUSTOMER } });
  assert.ok(chat?.humanTakeoverAt);
  assert.ok(chat.humanTakeoverAt.getTime() >= before);
});

test("history is saved without calling the order pipeline; media_placeholder upserts later", async (t) => {
  if (skip) return t.skip();
  await postWebhook(historyChunk);
  await flushWebhookQueue();
  const ours = await prisma.message.findUnique({ where: { wamid: ECHO_WAMID } });
  const theirs = await prisma.message.findUnique({ where: { wamid: HISTORY_WAMID } });
  const placeholder = await prisma.message.findUnique({ where: { wamid: PLACEHOLDER_WAMID } });
  assert.equal(ours?.direction, "history");
  assert.equal(ours?.fromMe, true);
  assert.equal(theirs?.fromMe, false);
  assert.equal(placeholder?.type, "media_placeholder");
  assert.equal((await getAccount()).historySyncProgress, 55);

  await postWebhook(historyMediaFollowup);
  await flushWebhookQueue();
  const filled = await prisma.message.findUnique({ where: { wamid: PLACEHOLDER_WAMID } });
  assert.equal(filled?.type, "image");
  assert.equal((await getAccount()).historySyncProgress, 100);
  assert.equal(await prisma.message.count({ where: { wamid: PLACEHOLDER_WAMID } }), 1);
});

test("history error 2593109 sets historySyncDeclined and stores no threads", async (t) => {
  if (skip) return t.skip();
  await postWebhook(historyDeclined);
  await flushWebhookQueue();
  assert.equal((await getAccount()).historySyncDeclined, true);
  assert.equal(await prisma.message.count(), 0);
});

test("smb_app_state_sync add/remove contacts", async (t) => {
  if (skip) return t.skip();
  await postWebhook(contactsAdd);
  await flushWebhookQueue();
  let c = await prisma.contact.findUnique({ where: { phoneNumber: CUSTOMER } });
  assert.equal(c?.fullName, "Pablo Morales");
  assert.equal(c?.removed, false);
  await postWebhook(contactsRemove);
  await flushWebhookQueue();
  c = await prisma.contact.findUnique({ where: { phoneNumber: CUSTOMER } });
  assert.equal(c?.removed, true);
  assert.equal(c?.fullName, "Pablo Morales");
});

test("account_update PARTNER_REMOVED / ACCOUNT_OFFBOARDED / ACCOUNT_RECONNECTED", async (t) => {
  if (skip) return t.skip();
  await prisma.whatsappAccount.upsert({ where: { id: ACCOUNT_ID }, create: { id: ACCOUNT_ID, status: "connected" }, update: { status: "connected" } });
  await postWebhook(partnerRemoved);
  await flushWebhookQueue();
  let a = await getAccount();
  assert.equal(a.status, "disconnected");
  assert.equal((a.disconnectionInfo as { reason: string }).reason, "PRIMARY_INACTIVITY");
  assert.equal((a.lastAccountEvent as { event: string }).event, "PARTNER_REMOVED");

  await postWebhook(accountReconnected);
  await flushWebhookQueue();
  a = await getAccount();
  assert.equal(a.status, "connected");
  assert.equal(a.disconnectionInfo, null);

  await postWebhook(accountOffboarded);
  await flushWebhookQueue();
  assert.equal((await getAccount()).status, "disconnected");
});

test("edit updates the original text; revoke marks it; unsupported is stored and does not crash", async (t) => {
  if (skip) return t.skip();
  await postWebhook(inboundText);
  await postWebhook(inboundEdit);
  await postWebhook(inboundRevoke);
  await postWebhook(inboundUnsupported);
  await postWebhook(inboundImage);
  await flushWebhookQueue();
  const original = await prisma.message.findUnique({ where: { wamid: TEXT_WAMID } });
  assert.equal(original?.edited, true);
  assert.equal(original?.revoked, true);
  assert.equal(original?.text, "20 ctn item A, 5 drum B");
  const unsupported = await prisma.message.findUnique({ where: { wamid: "wamid.unsupported-1" } });
  assert.equal(unsupported?.type, "unsupported");
  const image = await prisma.message.findUnique({ where: { wamid: "wamid.image-1" } });
  assert.equal(image?.type, "image");
  assert.equal(image?.text, "PO photo");
});

test("startup replay processes leftover unprocessed rows", async (t) => {
  if (skip) return t.skip();
  const row = await prisma.webhookEvent.create({
    data: { field: "messages", rawJson: inboundText as Prisma.InputJsonValue, processed: false },
  });
  await replayUnprocessed();
  await flushWebhookQueue();
  assert.equal((await prisma.webhookEvent.findUnique({ where: { id: row.id } }))?.processed, true);
  assert.ok(await prisma.message.findUnique({ where: { wamid: TEXT_WAMID } }));
});

test("two workers claiming the same event process it once", async (t) => {
  if (skip) return t.skip();
  const row = await prisma.webhookEvent.create({
    data: { field: "messages", rawJson: inboundText as Prisma.InputJsonValue, processed: false },
  });
  await Promise.all([processEventById(row.id), processEventById(row.id), processEventById(row.id)]);
  assert.equal(await prisma.message.count({ where: { wamid: TEXT_WAMID } }), 1);
  assert.equal((await prisma.webhookEvent.findUnique({ where: { id: row.id } }))?.processed, true);
});
