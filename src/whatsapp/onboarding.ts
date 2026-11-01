import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { encryptSecret } from "../lib/crypto";
import { logger } from "../lib/logger";
import {
  exchangeCodeForToken,
  getCoexistenceStatus,
  getPhoneNumbers,
  subscribeAppToWaba,
} from "../meta/graph";
import { ACCOUNT_ID, getAccount, getBusinessToken } from "./account";
import { startAllSyncs, type SyncResult } from "./sync";

const idString = z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,30}$/));

/**
 * WA_EMBEDDED_SIGNUP session info.
 * v4 (session info version 3) sends `waba_id`.
 * v5 sends `messaging_account_ids` (same numeric ID) plus `phone_number_id` and `is_on_biz_app`.
 */
export const sessionEventSchema = z.object({
  type: z.literal("WA_EMBEDDED_SIGNUP"),
  event: z.string().max(100),
  version: z.union([z.string(), z.number()]).optional(),
  data: z
    .object({
      waba_id: idString.optional(),
      messaging_account_ids: z.array(idString).optional(),
      phone_number_id: idString.optional(),
      business_id: idString.optional(),
      is_on_biz_app: z.boolean().optional(),
      primary_waac_ids: z.array(idString).optional(),
      current_step: z.string().max(200).optional(),
      error_message: z.string().max(2000).optional(),
      error_code: z.union([z.string(), z.number()]).optional(),
      session_id: z.string().max(200).optional(),
    })
    .passthrough()
    .optional(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

export function idsFromSessionEvent(e: SessionEvent) {
  return {
    wabaId: e.data?.waba_id ?? e.data?.messaging_account_ids?.[0],
    phoneNumberId: e.data?.phone_number_id,
    businessId: e.data?.business_id,
  };
}

export async function handleSessionEvent(e: SessionEvent): Promise<void> {
  const data: Prisma.WhatsappAccountUpdateInput = { lastSessionEvent: e as Prisma.InputJsonValue };
  if (e.event.startsWith("FINISH")) {
    const ids = idsFromSessionEvent(e);
    if (ids.wabaId) data.wabaId = ids.wabaId;
    if (ids.phoneNumberId) data.phoneNumberId = ids.phoneNumberId;
    if (ids.businessId) data.businessId = ids.businessId;
    if (typeof e.data?.is_on_biz_app === "boolean") data.isOnBizApp = e.data.is_on_biz_app;
    logger.info("Embedded Signup finished", { event: e.event, isOnBizApp: e.data?.is_on_biz_app, ...ids });
  } else if (e.event === "CANCEL") {
    logger.warn("Embedded Signup cancelled", { currentStep: e.data?.current_step });
  } else if (e.event === "ERROR") {
    logger.warn("Embedded Signup reported an error", {
      errorCode: e.data?.error_code,
      sessionId: e.data?.session_id,
      errorMessage: e.data?.error_message,
    });
  } else {
    logger.info("Embedded Signup session event", { event: e.event });
  }
  await getAccount();
  await prisma.whatsappAccount.update({ where: { id: ACCOUNT_ID }, data });
}

export type OnboardResult = {
  ok: boolean;
  step?: string;
  error?: string;
  coexistence?: { isOnBizApp: boolean | null; platformType: string | null; ok: boolean };
  sync?: { contacts: SyncResult; history: SyncResult };
};

type WaitOpts = { waitForWabaMs?: number; pollMs?: number };

async function fail(step: string, err: unknown): Promise<OnboardResult> {
  const error = `${step}: ${(err as Error)?.message ?? String(err)}`;
  logger.error("Onboarding step failed", { step, err });
  await prisma.whatsappAccount.update({ where: { id: ACCOUNT_ID }, data: { onboardingLastError: error } });
  return { ok: false, step, error };
}

/**
 * Full onboarding after the Embedded Signup popup returns a code.
 * The code expires 30 seconds after it's issued, so it is exchanged before anything else.
 */
export async function onboardWithCode(
  input: { code: string; wabaId?: string; phoneNumberId?: string; businessId?: string },
  opts: WaitOpts = {},
): Promise<OnboardResult> {
  await getAccount();
  let token: string;
  try {
    token = await exchangeCodeForToken(input.code);
  } catch (err) {
    return fail("exchange_code", err);
  }

  // A completed Embedded Signup is a new onboarding: Meta allows each sync once per onboarding,
  // and the 24h window restarts, so clear the previous onboarding's sync markers.
  await prisma.whatsappAccount.update({
    where: { id: ACCOUNT_ID },
    data: {
      businessTokenEncrypted: encryptSecret(token),
      status: "onboarding",
      onboardingLastError: null,
      onboardedAt: null,
      subscribedAt: null,
      isOnBizApp: null,
      platformType: null,
      disconnectionInfo: Prisma.DbNull,
      contactsSyncStartedAt: null,
      contactsSyncRequestId: null,
      contactsSyncInFlightAt: null,
      contactsSyncLastError: null,
      historySyncStartedAt: null,
      historySyncRequestId: null,
      historySyncInFlightAt: null,
      historySyncLastError: null,
      historySyncProgress: null,
      historySyncDeclined: false,
      ...(input.wabaId ? { wabaId: input.wabaId } : {}),
      ...(input.phoneNumberId ? { phoneNumberId: input.phoneNumberId } : {}),
      ...(input.businessId ? { businessId: input.businessId } : {}),
    },
  });
  logger.info("Business token stored (encrypted)");

  return completeOnboarding(opts);
}

/** Steps after the token exchange. Safe to re-run with the stored token (admin "retry" button). */
export async function completeOnboarding(opts: WaitOpts = {}): Promise<OnboardResult> {
  const waitForWabaMs = opts.waitForWabaMs ?? 15_000;
  const pollMs = opts.pollMs ?? 1_000;

  let account = await getAccount();
  let token: string;
  try {
    token = getBusinessToken(account);
  } catch (err) {
    return fail("load_token", err);
  }

  // The session event (with waba_id) can arrive just before or after the code.
  const deadline = Date.now() + waitForWabaMs;
  while (!account.wabaId && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    account = await getAccount();
  }
  if (!account.wabaId) {
    return fail("waba_id", new Error("No waba_id received from the Embedded Signup session event"));
  }
  const wabaId = account.wabaId;

  try {
    const numbers = await getPhoneNumbers(wabaId, token);
    const match = account.phoneNumberId ? numbers.find((n) => n.id === account.phoneNumberId) : numbers[0];
    if (!match) {
      throw new Error(
        account.phoneNumberId
          ? `Phone number ${account.phoneNumberId} is not on WABA ${wabaId}`
          : `WABA ${wabaId} has no phone numbers`,
      );
    }
    if (!account.phoneNumberId && numbers.length > 1) {
      logger.warn("WABA has multiple phone numbers; using the first", { count: numbers.length, phoneNumberId: match.id });
    }
    account = await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { phoneNumberId: match.id, displayPhoneNumber: match.display_phone_number ?? null },
    });
  } catch (err) {
    return fail("get_phone_numbers", err);
  }
  const phoneNumberId = account.phoneNumberId!;

  try {
    await subscribeAppToWaba(wabaId, token);
    await prisma.whatsappAccount.update({ where: { id: ACCOUNT_ID }, data: { subscribedAt: new Date() } });
  } catch (err) {
    return fail("subscribe_app", err);
  }

  // Coexistence numbers are already registered: Meta says to skip POST /{phone_number_id}/register.

  let coexistence: OnboardResult["coexistence"];
  try {
    const s = await getCoexistenceStatus(phoneNumberId, token);
    coexistence = {
      isOnBizApp: s.is_on_biz_app ?? null,
      platformType: s.platform_type ?? null,
      ok: s.is_on_biz_app === true && s.platform_type === "CLOUD_API",
    };
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { isOnBizApp: coexistence.isOnBizApp, platformType: coexistence.platformType },
    });
    if (!coexistence.ok) logger.warn("Coexistence check did not pass", coexistence);
  } catch (err) {
    // Meta documents this check as optional, so a failure here doesn't block onboarding.
    logger.warn("Coexistence check request failed; continuing", { err });
  }

  account = await getAccount();
  await prisma.whatsappAccount.update({
    where: { id: ACCOUNT_ID },
    data: { status: "connected", onboardedAt: account.onboardedAt ?? new Date(), onboardingLastError: null },
  });
  logger.info("Onboarding complete; starting contacts and history sync", { wabaId, phoneNumberId });

  const sync = await startAllSyncs();
  return { ok: true, coexistence, sync };
}