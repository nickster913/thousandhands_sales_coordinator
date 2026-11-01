import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { GraphError, requestSmbAppData, type SmbSyncType } from "../meta/graph";
import { ACCOUNT_ID, getAccount, getBusinessToken, syncWindowRemainingMs } from "./account";

/** An in-flight claim older than this is assumed to be from a crashed process and may be re-claimed. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

export type SyncKind = "contacts" | "history";

export type SyncResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: "already_started" | "in_flight" | "not_onboarded" | "window_expired" | "failed"; error?: string };

const FIELDS = {
  contacts: {
    syncType: "smb_app_state_sync" as SmbSyncType,
    startedAt: "contactsSyncStartedAt",
    requestId: "contactsSyncRequestId",
    inFlightAt: "contactsSyncInFlightAt",
    lastError: "contactsSyncLastError",
  },
  history: {
    syncType: "history" as SmbSyncType,
    startedAt: "historySyncStartedAt",
    requestId: "historySyncRequestId",
    inFlightAt: "historySyncInFlightAt",
    lastError: "historySyncLastError",
  },
} as const;

/**
 * Starts the contacts or history sync, at most once successfully per onboarding.
 *
 * The claim is a single conditional UPDATE (atomic in Postgres): it only succeeds if no sync has
 * succeeded yet and no other call is in flight, so concurrent callers can't both hit Meta.
 */
export async function startSync(kind: SyncKind, now = new Date()): Promise<SyncResult> {
  const f = FIELDS[kind];
  const account = await getAccount();

  if (account[f.startedAt]) return { ok: false, reason: "already_started" };
  if (!account.onboardedAt || !account.phoneNumberId || !account.businessTokenEncrypted) {
    return { ok: false, reason: "not_onboarded" };
  }
  const remaining = syncWindowRemainingMs(account, now.getTime());
  if (remaining !== null && remaining <= 0) {
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { [f.lastError]: "24-hour sync window has passed. Offboard and complete Embedded Signup again." },
    });
    return { ok: false, reason: "window_expired" };
  }

  const claimed = await prisma.whatsappAccount.updateMany({
    where: {
      id: ACCOUNT_ID,
      [f.startedAt]: null,
      OR: [{ [f.inFlightAt]: null }, { [f.inFlightAt]: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { [f.inFlightAt]: now },
  });
  if (claimed.count !== 1) {
    const latest = await getAccount();
    return { ok: false, reason: latest[f.startedAt] ? "already_started" : "in_flight" };
  }

  try {
    const requestId = await requestSmbAppData(account.phoneNumberId, getBusinessToken(account), f.syncType);
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { [f.startedAt]: new Date(), [f.requestId]: requestId, [f.inFlightAt]: null, [f.lastError]: null },
    });
    logger.info("SMB app data sync started", { kind, requestId });
    return { ok: true, requestId };
  } catch (err) {
    const message =
      err instanceof GraphError && err.outcomeUnknown
        ? `${err.message}. Meta may have accepted it; if a retry is rejected, check whether webhooks are arriving.`
        : (err as Error).message;
    await prisma.whatsappAccount.update({
      where: { id: ACCOUNT_ID },
      data: { [f.inFlightAt]: null, [f.lastError]: message },
    });
    logger.error("SMB app data sync failed", { kind, err });
    return { ok: false, reason: "failed", error: message };
  }
}

/** Meta's documented order: contacts first, then history. */
export async function startAllSyncs(): Promise<{ contacts: SyncResult; history: SyncResult }> {
  const contacts = await startSync("contacts");
  const history = await startSync("history");
  return { contacts, history };
}
