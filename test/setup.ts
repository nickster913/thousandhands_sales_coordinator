import crypto from "node:crypto";

/** Fake, non-secret values so src/config/env.ts validates during tests. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://thousandhands:thousandhands@localhost:5432/thousandhands_test?schema=public",
  APP_BASE_URL: "https://app.example.test",
  META_APP_ID: "1234567890",
  META_APP_SECRET: "test-app-secret",
  META_CONFIG_ID: "cfg-123",
  META_GRAPH_VERSION: "v26.0",
  WEBHOOK_VERIFY_TOKEN: "test-verify-token",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  ADMIN_PASSWORD: "correct-horse-battery",
  SESSION_SECRET: crypto.randomBytes(48).toString("base64"),
  INVOICE_COMPANY_NAME: "Thousand Hands Test Pte Ltd",
};

for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
