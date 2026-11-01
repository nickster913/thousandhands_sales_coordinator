import { z } from "zod";

const required = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

/** Treats empty strings as "not set", so `FOO=` in .env behaves like an absent var (and gets its default). */
const blank = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner);
const optional = <T extends z.ZodTypeAny>(inner: T) => blank(inner.optional());

function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const b = Buffer.from(value, "base64");
  return b.length === 32 ? b : null;
}

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: required("DATABASE_URL"),
  PORT: blank(z.coerce.number().int().positive().default(3000)),
  APP_BASE_URL: required("APP_BASE_URL").pipe(z.url("APP_BASE_URL must be a URL")),

  META_APP_ID: required("META_APP_ID"),
  META_APP_SECRET: required("META_APP_SECRET"),
  META_CONFIG_ID: required("META_CONFIG_ID"),
  META_GRAPH_VERSION: blank(
    z.string().trim().regex(/^v\d+\.\d+$/, "META_GRAPH_VERSION must look like v26.0").default("v26.0"),
  ),
  WEBHOOK_VERIFY_TOKEN: required("WEBHOOK_VERIFY_TOKEN"),

  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  AI_MODEL: blank(z.string().trim().min(1).default("claude-sonnet-5-5")),

  ENCRYPTION_KEY: required("ENCRYPTION_KEY").refine((v) => decodeKey(v) !== null, {
    message: "ENCRYPTION_KEY must be 32 bytes, encoded as base64 or 64 hex chars",
  }),
  ADMIN_PASSWORD: required("ADMIN_PASSWORD").min(12, "ADMIN_PASSWORD must be at least 12 characters"),
  SESSION_SECRET: required("SESSION_SECRET").min(32, "SESSION_SECRET must be at least 32 characters"),

  NOTIFY_WEBHOOK_URL: optional(z.url("NOTIFY_WEBHOOK_URL must be a URL")),
  TAKEOVER_PAUSE_HOURS: blank(z.coerce.number().positive().default(2)),

  INVOICE_COMPANY_NAME: required("INVOICE_COMPANY_NAME"),
  INVOICE_COMPANY_ADDRESS: optional(z.string().trim()),
  INVOICE_COMPANY_UEN: optional(z.string().trim()),
  INVOICE_LOGO_URL: optional(z.url("INVOICE_LOGO_URL must be a URL")),
  GST_RATE: blank(z.coerce.number().min(0).max(1, "GST_RATE is a fraction, e.g. 0.09").default(0.09)),
});

export type Env = z.infer<typeof schema> & { encryptionKey: Buffer; isProduction: boolean };

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
    APP_BASE_URL: data.APP_BASE_URL.replace(/\/+$/, ""),
    encryptionKey: decodeKey(data.ENCRYPTION_KEY)!,
    isProduction: data.NODE_ENV === "production",
  };
}

export const env = load();
