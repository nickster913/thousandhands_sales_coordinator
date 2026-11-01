import type { WhatsappAccount } from "@prisma/client";
import { prisma } from "../lib/db";
import { decryptSecret } from "../lib/crypto";

/** We only ever onboard our own number, so the account is a single row with a fixed id. */
export const ACCOUNT_ID = 1;

export const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getAccount(): Promise<WhatsappAccount> {
  return prisma.whatsappAccount.upsert({ where: { id: ACCOUNT_ID }, create: { id: ACCOUNT_ID }, update: {} });
}

export function getBusinessToken(account: Pick<WhatsappAccount, "businessTokenEncrypted">): string {
  if (!account.businessTokenEncrypted) throw new Error("No business token stored; complete Embedded Signup first");
  return decryptSecret(account.businessTokenEncrypted);
}

/** Milliseconds left in Meta's 24h contacts/history sync window, or null if not onboarded. */
export function syncWindowRemainingMs(account: Pick<WhatsappAccount, "onboardedAt">, now = Date.now()): number | null {
  if (!account.onboardedAt) return null;
  return account.onboardedAt.getTime() + SYNC_WINDOW_MS - now;
}
