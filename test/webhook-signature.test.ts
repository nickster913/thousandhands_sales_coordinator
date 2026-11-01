import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { env } from "../src/config/env";
import { signHubPayload, verifyHubSignature } from "../src/webhook/signature";
import { startApp } from "./helpers";

const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

test("accepts a matching X-Hub-Signature-256 of the raw bytes", () => {
  assert.equal(verifyHubSignature(body, signHubPayload(body)), true);
});

test("rejects a missing, truncated, or wrong-secret signature", () => {
  assert.equal(verifyHubSignature(body, undefined), false);
  assert.equal(verifyHubSignature(body, "sha256=abcd"), false);
  assert.equal(verifyHubSignature(body, signHubPayload(body, "other-secret")), false);
  assert.equal(verifyHubSignature(Buffer.from(body.toString() + " "), signHubPayload(body)), false);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});

test("GET /webhook returns the challenge when the verify token matches", async () => {
  const r = await fetch(
    `${app.base}/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.WEBHOOK_VERIFY_TOKEN)}&hub.challenge=challenge-token-99`,
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(await r.text(), "challenge-token-99");
});

test("GET /webhook is 403 when the verify token is wrong or mode is not subscribe", async () => {
  const bad = await fetch(`${app.base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x`);
  assert.equal(bad.status, 403);
  const mode = await fetch(
    `${app.base}/webhook?hub.mode=unsubscribe&hub.verify_token=${encodeURIComponent(env.WEBHOOK_VERIFY_TOKEN)}&hub.challenge=x`,
  );
  assert.equal(mode.status, 403);
});

test("POST /webhook is 401 without a valid signature and does not require login", async () => {
  const r = await fetch(`${app.base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signHubPayload(body, "wrong") },
    body,
  });
  assert.equal(r.status, 401);
});
