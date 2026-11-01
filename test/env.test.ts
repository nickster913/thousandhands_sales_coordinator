import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { TEST_ENV } from "./setup";

/** Loads src/config/env.ts in a child process with exactly the given env vars. */
function loadEnv(vars: Record<string, string>) {
  const script = `const { env } = require("./src/config/env"); console.log(JSON.stringify({ port: env.PORT, gst: env.GST_RATE, pause: env.TAKEOVER_PAUSE_HOURS, model: env.AI_MODEL, graph: env.META_GRAPH_VERSION, base: env.APP_BASE_URL }));`;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...vars },
    encoding: "utf8",
  });
}

test("fails with a clear list of missing vars and exits 1", () => {
  const r = loadEnv({});
  assert.equal(r.status, 1);
  for (const name of ["DATABASE_URL", "APP_BASE_URL", "META_APP_SECRET", "ANTHROPIC_API_KEY", "ENCRYPTION_KEY", "INVOICE_COMPANY_NAME"]) {
    assert.match(r.stderr, new RegExp(`${name} is required`));
  }
});

test("never prints env values when validation fails", () => {
  const r = loadEnv({ ...TEST_ENV, ENCRYPTION_KEY: "not-a-valid-key-SECRETVALUE", META_APP_SECRET: "SHOULD-NOT-APPEAR" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENCRYPTION_KEY must be 32 bytes/);
  assert.doesNotMatch(r.stderr, /SECRETVALUE|SHOULD-NOT-APPEAR/);
});

test("uses PORT from the environment (Railway sets it)", () => {
  const r = loadEnv({ ...TEST_ENV, PORT: "8123" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).port, 8123);
});

test("blank optional vars fall back to defaults", () => {
  const r = loadEnv({
    ...TEST_ENV,
    PORT: "",
    GST_RATE: "",
    TAKEOVER_PAUSE_HOURS: "",
    AI_MODEL: "",
    META_GRAPH_VERSION: "",
    NOTIFY_WEBHOOK_URL: "",
    INVOICE_LOGO_URL: "",
    APP_BASE_URL: "https://app.example.test/",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    port: 3000,
    gst: 0.09,
    pause: 2,
    model: "claude-sonnet-5-5",
    graph: "v26.0",
    base: "https://app.example.test",
  });
});

test("rejects a GST_RATE given as a percentage", () => {
  const r = loadEnv({ ...TEST_ENV, GST_RATE: "9" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GST_RATE is a fraction/);
});
