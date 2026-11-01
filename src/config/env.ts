import { z } from "zod";

const required = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const b = Buffer.from(value, "base64");
  return b.length === 32 ? b : null;
}

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: required("DATABASE_URL"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: required("PUBLIC_BASE_URL").pipe(z.url("PUBLIC_BASE_URL must be a URL")),
  META_APP_ID: required("META_APP_ID"),
  META_APP_SECRET: required("META_APP_SECRET"),
  META_CONFIG_ID: required("META_CONFIG_ID"),
  META_GRAPH_VERSION: required("META_GRAPH_VERSION").regex(/^v\d+\.\d+$/, "META_GRAPH_VERSION must look like v26.0"),
  WEBHOOK_VERIFY_TOKEN: required("WEBHOOK_VERIFY_TOKEN"),
  TOKEN_ENCRYPTION_KEY: required("TOKEN_ENCRYPTION_KEY").refine((v) => decodeKey(v) !== null, {
    message: "TOKEN_ENCRYPTION_KEY must be 32 bytes, encoded as base64 or 64 hex chars",
  }),
  AI_API_KEY: required("AI_API_KEY"),
  AI_MODEL: required("AI_MODEL"),
  AI_TAKEOVER_PAUSE_MINUTES: z.coerce.number().positive().default(120),
  ADMIN_PASSWORD: required("ADMIN_PASSWORD").min(12, "ADMIN_PASSWORD must be at least 12 characters"),
  SESSION_SECRET: required("SESSION_SECRET").min(32, "SESSION_SECRET must be at least 32 characters"),
});

export type Env = z.infer<typeof schema> & { tokenKey: Buffer; isProduction: boolean };

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
    // Only names and validation messages are printed, never values.
    console.error(`\nInvalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example.\n`);
    process.exit(1);
  }
  const data = parsed.data;
  return {
    ...data,
    PUBLIC_BASE_URL: data.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    tokenKey: decodeKey(data.TOKEN_ENCRYPTION_KEY)!,
    isProduction: data.NODE_ENV === "production",
  };
}

export const env = load();
