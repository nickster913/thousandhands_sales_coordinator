import { prisma } from "../src/lib/db";

let available: boolean | null = null;

/** True when the test database is reachable and migrated; DB tests skip otherwise. */
export async function dbAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await prisma.$queryRaw`SELECT 1 FROM "WhatsappAccount" LIMIT 1`;
    available = true;
  } catch {
    available = false;
    console.warn("[test] Test database unavailable; skipping DB tests. Run `npm run db:up`.");
  }
  return available;
}

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "WhatsappAccount", "Contact", "Message", "ChatState", "WebhookEvent" RESTART IDENTITY CASCADE`,
  );
}
