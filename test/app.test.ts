import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { login, startApp } from "./helpers";

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
});

test("GET /health returns 200 ok without auth", async () => {
  const r = await fetch(`${app.base}/health`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
});

test("/admin pages redirect to login when not authenticated", async () => {
  const r = await fetch(`${app.base}/admin/connect`, { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/admin/login?next=%2Fadmin%2Fconnect");
});

test("/api/whatsapp/* returns 401 when not authenticated", async () => {
  const r = await fetch(`${app.base}/api/whatsapp/onboard`, { method: "POST" });
  assert.equal(r.status, 401);
});

test("login sets an httpOnly, Secure, SameSite=Lax session cookie and grants access", async () => {
  const r = await login(app.base);
  assert.equal(r.status, 303);
  const cookie = r.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);

  const page = await fetch(`${app.base}/admin`, { headers: { cookie: cookie.split(";")[0]! }, redirect: "manual" });
  assert.equal(page.status, 200);
});

test("tampered session cookie is rejected", async () => {
  const cookie = (await login(app.base)).headers.get("set-cookie")!.split(";")[0]!;
  const r = await fetch(`${app.base}/admin`, { headers: { cookie: cookie.slice(0, -3) + "abc" }, redirect: "manual" });
  assert.equal(r.status, 303);
});

test("login ignores off-site `next` redirects", async () => {
  const r = await fetch(`${app.base}/admin/login`, {
    method: "POST",
    body: new URLSearchParams({ password: process.env.ADMIN_PASSWORD!, next: "//evil.example" }),
    redirect: "manual",
  });
  assert.equal(r.headers.get("location"), "/admin");
});

test("trust proxy: login rate limit is keyed on the client IP from X-Forwarded-For", async () => {
  const attempt = (ip: string) =>
    fetch(`${app.base}/admin/login`, {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: new URLSearchParams({ password: "wrong-password" }),
    });
  for (let i = 0; i < 5; i++) assert.equal((await attempt("203.0.113.7")).status, 401);
  assert.equal((await attempt("203.0.113.7")).status, 429);
  // A different client behind the same proxy is unaffected.
  assert.equal((await attempt("203.0.113.8")).status, 401);
});

test("security headers are set", async () => {
  const r = await fetch(`${app.base}/health`);
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.ok(r.headers.get("strict-transport-security"));
});
