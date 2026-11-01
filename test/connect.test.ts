import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../src/lib/db";
import { dbAvailable, resetDb } from "./db";
import { BUSINESS_TOKEN, CODE, happyRoutes, installFakeGraph, WABA_ID } from "./fakeGraph";
import { login, startApp } from "./helpers";

let app: Awaited<ReturnType<typeof startApp>>;
let cookie = "";
let skip = false;

before(async () => {
  skip = !(await dbAvailable());
  app = await startApp();
  cookie = (await login(app.base)).headers.get("set-cookie")!.split(";")[0]!;
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  if (!skip) await resetDb();
});

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${app.base}${path}`, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) }, redirect: "manual" });

const postJson = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  authed(path, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

test("connect page requires login", async () => {
  const r = await fetch(`${app.base}/admin/connect`, { redirect: "manual" });
  assert.equal(r.status, 303);
});

test("connect page renders non-secret config, the documented FB.login options, and no secrets", async (t) => {
  if (skip) return t.skip();
  const r = await authed("/admin/connect");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /https:\/\/connect\.facebook\.net\/en_US\/sdk\.js/);
  assert.match(html, new RegExp(`"appId":"${process.env.META_APP_ID}"`));
  assert.match(html, new RegExp(`"configId":"${process.env.META_CONFIG_ID}"`));
  assert.match(html, /"graphVersion":"v26.0"/);
  assert.match(html, /"extras":\{"version":"v5"\}/);
  assert.match(html, /response_type: "code"/);
  assert.match(html, /override_default_response_type: true/);
  for (const secret of ["META_APP_SECRET", "WEBHOOK_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "SESSION_SECRET", "ADMIN_PASSWORD", "ENCRYPTION_KEY"]) {
    assert.ok(!html.includes(process.env[secret]!), `${secret} leaked into the page`);
  }
  const csp = r.headers.get("content-security-policy")!;
  const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
  assert.ok(html.includes(`nonce="${nonce}"`));
});

test("session-event rejects non-Embedded-Signup payloads", async (t) => {
  if (skip) return t.skip();
  const r = await postJson("/api/whatsapp/session-event", { type: "SOMETHING_ELSE", event: "FINISH" });
  assert.equal(r.status, 400);
});

test("cross-origin POSTs are rejected", async (t) => {
  if (skip) return t.skip();
  const r = await postJson("/api/whatsapp/session-event", { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

test("end-to-end: session event + onboard via HTTP, status card reflects it, logs contain no secrets", async (t) => {
  if (skip) return t.skip();
  const fake = installFakeGraph(happyRoutes());
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l: string) => lines.push(String(l));
  console.error = (l: string) => lines.push(String(l));
  try {
    const origin = { origin: process.env.APP_BASE_URL! };
    const ev = await postJson("/api/whatsapp/session-event", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: WABA_ID } }, origin);
    assert.equal(ev.status, 200);
    const r = await postJson("/api/whatsapp/onboard", { code: CODE, waba_id: WABA_ID }, origin);
    const body = (await r.json()) as { ok: boolean };
    assert.equal(r.status, 200);
    assert.equal(body.ok, true);

    const again = await authed("/api/whatsapp/sync/contacts", { method: "POST", headers: origin });
    assert.equal(again.status, 409);

    const card = await (await authed("/admin/connect/status")).text();
    assert.match(card, /connected/);
    assert.match(card, /req-smb_app_state_sync/);
    assert.match(card, /req-history/);
    assert.match(card, /disabled>Start contacts/);
    assert.match(card, /disabled>Start history/);
  } finally {
    console.log = origLog;
    console.error = origErr;
    fake.restore();
  }
  const out = lines.join("\n");
  assert.ok(out.includes("Graph API response"), "Graph responses are logged");
  for (const s of [BUSINESS_TOKEN, CODE, process.env.META_APP_SECRET!]) assert.ok(!out.includes(s), `log leaked ${s.slice(0, 6)}…`);
});
