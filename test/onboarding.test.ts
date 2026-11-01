import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { prisma } from "../src/lib/db";
import { decryptSecret } from "../src/lib/crypto";
import { ACCOUNT_ID, getAccount } from "../src/whatsapp/account";
import { completeOnboarding, handleSessionEvent, onboardWithCode, sessionEventSchema } from "../src/whatsapp/onboarding";
import { startSync } from "../src/whatsapp/sync";
import { dbAvailable, resetDb } from "./db";
import { BUSINESS_TOKEN, CODE, happyRoutes, installFakeGraph, PHONE_ID, WABA_ID } from "./fakeGraph";

const finishV4 = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: WABA_ID } };
const finishV5 = {
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  data: { phone_number_id: PHONE_ID, is_on_biz_app: true, messaging_account_ids: [WABA_ID], primary_waac_ids: [], business_id: "2729063490586005" },
};

let skip = false;
before(async () => {
  skip = !(await dbAvailable());
});
after(async () => {
  await prisma.$disconnect();
});

describe("Embedded Signup onboarding", () => {
  let fake: ReturnType<typeof installFakeGraph> | null = null;
  beforeEach(async () => {
    if (skip) return;
    await resetDb();
  });
  afterEach(() => {
    fake?.restore();
    fake = null;
  });

  test("session event: v4 FINISH stores waba_id", async (t) => {
    if (skip) return t.skip();
    await handleSessionEvent(sessionEventSchema.parse(finishV4));
    const a = await getAccount();
    assert.equal(a.wabaId, WABA_ID);
    assert.equal((a.lastSessionEvent as { event: string }).event, "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING");
  });

  test("session event: v5 FINISH (messaging_account_ids) stores waba, phone and business IDs", async (t) => {
    if (skip) return t.skip();
    await handleSessionEvent(sessionEventSchema.parse(finishV5));
    const a = await getAccount();
    assert.equal(a.wabaId, WABA_ID);
    assert.equal(a.phoneNumberId, PHONE_ID);
    assert.equal(a.businessId, "2729063490586005");
    assert.equal(a.isOnBizApp, true);
  });

  test("session event: CANCEL is saved without changing IDs", async (t) => {
    if (skip) return t.skip();
    await handleSessionEvent(sessionEventSchema.parse(finishV4));
    await handleSessionEvent(sessionEventSchema.parse({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } }));
    const a = await getAccount();
    assert.equal(a.wabaId, WABA_ID);
    assert.equal((a.lastSessionEvent as { event: string }).event, "CANCEL");
  });

  test("full onboarding: exchanges code, encrypts token, subscribes, skips /register, verifies, syncs once each in order", async (t) => {
    if (skip) return t.skip();
    fake = installFakeGraph(happyRoutes());
    await handleSessionEvent(sessionEventSchema.parse(finishV4));

    const result = await onboardWithCode({ code: CODE });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.coexistence, { isOnBizApp: true, platformType: "CLOUD_API", ok: true });

    const ops = fake.calls.map((c) => `${c.method} ${c.path}${c.body ? ` ${(c.body as { sync_type?: string }).sync_type}` : ""}`);
    assert.deepEqual(ops, [
      "GET /oauth/access_token",
      `GET /${WABA_ID}/phone_numbers`,
      `POST /${WABA_ID}/subscribed_apps`,
      `GET /${PHONE_ID}`,
      `POST /${PHONE_ID}/smb_app_data smb_app_state_sync`,
      `POST /${PHONE_ID}/smb_app_data history`,
    ]);
    assert.ok(!fake.calls.some((c) => c.path.endsWith("/register")), "must not call /register for coexistence");

    const exchange = fake.calls[0]!;
    assert.deepEqual(exchange.query, { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, code: CODE });
    assert.equal(exchange.auth, null);
    for (const c of fake.calls.slice(1)) assert.equal(c.auth, `Bearer ${BUSINESS_TOKEN}`);
    assert.deepEqual(fake.calls[4]!.body, { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" });
    assert.equal(fake.calls[3]!.query.fields, "is_on_biz_app,platform_type");

    const a = await getAccount();
    assert.notEqual(a.businessTokenEncrypted, BUSINESS_TOKEN);
    assert.ok(!a.businessTokenEncrypted!.includes(BUSINESS_TOKEN));
    assert.equal(decryptSecret(a.businessTokenEncrypted!), BUSINESS_TOKEN);
    assert.equal(a.status, "connected");
    assert.equal(a.phoneNumberId, PHONE_ID);
    assert.equal(a.displayPhoneNumber, "+65 8123 4567");
    assert.ok(a.onboardedAt && a.subscribedAt);
    assert.equal(a.contactsSyncRequestId, "req-smb_app_state_sync");
    assert.equal(a.historySyncRequestId, "req-history");
    assert.equal(a.contactsSyncInFlightAt, null);
  });

  test("waits for a session event that arrives after the code", async (t) => {
    if (skip) return t.skip();
    fake = installFakeGraph(happyRoutes());
    const p = onboardWithCode({ code: CODE }, { waitForWabaMs: 3000, pollMs: 50 });
    setTimeout(() => void handleSessionEvent(sessionEventSchema.parse(finishV4)), 200);
    const result = await p;
    assert.equal(result.ok, true, result.error);
    assert.equal((await getAccount()).wabaId, WABA_ID);
  });

  test("fails clearly if waba_id never arrives, keeps the token for a retry", async (t) => {
    if (skip) return t.skip();
    fake = installFakeGraph(happyRoutes());
    const result = await onboardWithCode({ code: CODE }, { waitForWabaMs: 100, pollMs: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.step, "waba_id");
    const a = await getAccount();
    assert.ok(a.businessTokenEncrypted);
    assert.match(a.onboardingLastError!, /waba_id/);

    await handleSessionEvent(sessionEventSchema.parse(finishV4));
    const retry = await completeOnboarding({ waitForWabaMs: 0 });
    assert.equal(retry.ok, true, retry.error);
    assert.equal(fake.calls.filter((c) => c.path === "/oauth/access_token").length, 1, "code is exchanged only once");
  });

  test("code exchange failure is recorded and nothing else is called", async (t) => {
    if (skip) return t.skip();
    fake = installFakeGraph(
      happyRoutes({
        "GET /oauth/access_token": () => ({ status: 400, body: { error: { message: "This authorization code has expired.", code: 100 } } }),
      }),
    );
    const result = await onboardWithCode({ code: CODE });
    assert.equal(result.ok, false);
    assert.equal(result.step, "exchange_code");
    assert.equal(fake.calls.length, 1);
    assert.match((await getAccount()).onboardingLastError!, /expired/);
  });

  test("coexistence check mismatch is saved but doesn't block onboarding", async (t) => {
    if (skip) return t.skip();
    fake = installFakeGraph(
      happyRoutes({ [`GET /${PHONE_ID}`]: () => ({ body: { is_on_biz_app: false, platform_type: "CLOUD_API", id: PHONE_ID } }) }),
    );
    await handleSessionEvent(sessionEventSchema.parse(finishV4));
    const result = await onboardWithCode({ code: CODE });
    assert.equal(result.ok, true);
    assert.equal(result.coexistence?.ok, false);
    assert.equal((await getAccount()).isOnBizApp, false);
  });
});

describe("one-shot sync guard", () => {
  let fake: ReturnType<typeof installFakeGraph> | null = null;
  beforeEach(async () => {
    if (skip) return;
    await resetDb();
    fake = installFakeGraph(happyRoutes());
    await handleSessionEvent(sessionEventSchema.parse(finishV4));
    await onboardWithCode({ code: CODE });
    fake.calls.length = 0;
  });
  afterEach(() => {
    fake?.restore();
    fake = null;
  });

  const smbCalls = () => fake!.calls.filter((c) => c.path.endsWith("/smb_app_data"));

  test("a successful sync is never requested again", async (t) => {
    if (skip) return t.skip();
    const r = await startSync("contacts");
    assert.deepEqual(r, { ok: false, reason: "already_started" });
    assert.equal(smbCalls().length, 0);
  });

  test("concurrent attempts make exactly one Graph call", async (t) => {
    if (skip) return t.skip();
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { contactsSyncStartedAt: null, contactsSyncRequestId: null },
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => startSync("contacts")));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(smbCalls().length, 1);
  });

  test("a failed attempt records the error and can be retried", async (t) => {
    if (skip) return t.skip();
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { historySyncStartedAt: null, historySyncRequestId: null },
    });
    fake!.restore();
    fake = installFakeGraph(
      happyRoutes({ [`POST /${PHONE_ID}/smb_app_data`]: () => ({ status: 500, body: { error: { message: "Temporary failure", code: 2 } } }) }),
    );
    const first = await startSync("history");
    assert.equal(first.ok, false);
    let a = await getAccount();
    assert.match(a.historySyncLastError!, /Temporary failure/);
    assert.equal(a.historySyncInFlightAt, null);
    assert.equal(a.historySyncStartedAt, null);

    fake.restore();
    fake = installFakeGraph(happyRoutes());
    const second = await startSync("history");
    assert.equal(second.ok, true);
    a = await getAccount();
    assert.equal(a.historySyncRequestId, "req-history");
    assert.equal(a.historySyncLastError, null);
  });

  test("refuses after the 24-hour window", async (t) => {
    if (skip) return t.skip();
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { contactsSyncStartedAt: null, onboardedAt: new Date(Date.now() - 25 * 3600_000) },
    });
    const r = await startSync("contacts");
    assert.deepEqual(r, { ok: false, reason: "window_expired" });
    assert.equal(smbCalls().length, 0);
  });
});
