import type { WhatsappAccount } from "@prisma/client";
import { syncWindowRemainingMs } from "../whatsapp/account";
import { escapeHtml } from "./layout";

function fmtDate(d: Date | null | undefined): string {
  return d ? escapeHtml(d.toISOString().replace("T", " ").slice(0, 19) + " UTC") : "—";
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function badge(kind: "ok" | "warn" | "err" | "", text: string) {
  return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
}

type SessionInfo = {
  event?: string;
  data?: {
    current_step?: string;
    error_message?: string;
    error_code?: unknown;
    session_id?: string;
    is_on_biz_app?: boolean;
  };
};

export function isPolling(a: WhatsappAccount): boolean {
  if (a.status === "onboarding") return true;
  if (a.contactsSyncInFlightAt || a.historySyncInFlightAt) return true;
  return !!a.historySyncStartedAt && !a.historySyncDeclined && (a.historySyncProgress ?? 0) < 100;
}

function syncRow(
  label: string,
  action: "contacts" | "history",
  startedAt: Date | null,
  requestId: string | null,
  inFlightAt: Date | null,
  lastError: string | null,
  canStart: boolean,
  extra = "",
) {
  let state: string;
  if (startedAt) state = `${badge("ok", "started")} ${fmtDate(startedAt)} <span class="muted mono">request_id ${escapeHtml(requestId)}</span>`;
  else if (inFlightAt) state = badge("warn", "requesting…");
  else if (lastError) state = `${badge("err", "failed")} <span class="mono">${escapeHtml(lastError)}</span>`;
  else state = badge("", "not started");
  const disabled = startedAt || inFlightAt || !canStart ? "disabled" : "";
  const btn = `<button type="button" data-action="${action}" ${disabled}>Start ${escapeHtml(label.toLowerCase())}</button>`;
  return `<tr><th>${escapeHtml(label)}</th><td>${state}${extra}<div class="spaced">${btn}</div></td></tr>`;
}

export function renderStatusCard(a: WhatsappAccount, now = Date.now()): string {
  const alerts: string[] = [];
  const session = (a.lastSessionEvent ?? null) as SessionInfo | null;

  if (a.status === "disconnected") {
    const info = a.disconnectionInfo ? ` <span class="mono">${escapeHtml(JSON.stringify(a.disconnectionInfo))}</span>` : "";
    alerts.push(`<div class="alert error"><strong>Disconnected from Cloud API.</strong> The bot can't send messages. Re-run Embedded Signup to reconnect.${info}</div>`);
  }
  if (a.onboardingLastError) {
    alerts.push(`<div class="alert error"><strong>Onboarding error:</strong> <span class="mono">${escapeHtml(a.onboardingLastError)}</span></div>`);
  }
  if (session?.event === "CANCEL") {
    alerts.push(`<div class="alert warn">Last signup was cancelled at step <span class="mono">${escapeHtml(session.data?.current_step ?? "unknown")}</span>.</div>`);
  } else if (session?.event === "FINISH_ONLY_WABA") {
    alerts.push(`<div class="alert error">Signup finished without a phone number (FINISH_ONLY_WABA). Connect again and pick the WhatsApp Business app number.</div>`);
  } else if (session?.event === "FINISH" && session.data?.is_on_biz_app === false) {
    alerts.push(`<div class="alert warn">This number is not on the WhatsApp Business app (<span class="mono">is_on_biz_app=false</span>). Coexistence will not apply; contacts/history sync will fail.</div>`);
  } else if (session?.event === "ERROR") {
    alerts.push(
      `<div class="alert error">Last signup reported an error: ${escapeHtml(session.data?.error_message ?? "unknown")} <span class="mono">(code ${escapeHtml(session.data?.error_code)}, session ${escapeHtml(session.data?.session_id)})</span></div>`,
    );
  }

  const remaining = syncWindowRemainingMs(a, now);
  const syncsPending = !a.contactsSyncStartedAt || !a.historySyncStartedAt;
  if (remaining !== null && syncsPending) {
    alerts.push(
      remaining > 0
        ? `<div class="alert warn"><strong>${fmtDuration(remaining)} left</strong> in Meta's 24-hour window to start the contacts and history sync. Keep the WhatsApp Business app open on your phone.</div>`
        : `<div class="alert error"><strong>The 24-hour sync window has passed.</strong> To sync, disconnect in the WhatsApp Business app (Settings › Account › Business Platform) and run Embedded Signup again.</div>`,
    );
  }

  const coexOk = a.isOnBizApp === true && a.platformType === "CLOUD_API";
  const coex =
    a.isOnBizApp === null && a.platformType === null
      ? badge("", "not checked")
      : `${coexOk ? badge("ok", "pass") : badge("err", "unexpected")} <span class="mono">is_on_biz_app=${escapeHtml(a.isOnBizApp)} platform_type=${escapeHtml(a.platformType)}</span>`;

  const statusBadge =
    a.status === "connected" ? badge("ok", "connected")
    : a.status === "onboarding" ? badge("warn", "onboarding…")
    : a.status === "disconnected" ? badge("err", "disconnected")
    : badge("", "not connected");

  const canStartSync = !!a.onboardedAt && (remaining ?? 0) > 0;
  let historyExtra = "";
  if (a.historySyncDeclined) historyExtra = ` ${badge("warn", "business declined to share history")}`;
  else if (a.historySyncStartedAt) historyExtra = ` <span>progress ${escapeHtml(a.historySyncProgress ?? 0)}%</span>`;

  const retry =
    a.businessTokenEncrypted && a.status !== "connected"
      ? `<p><button type="button" class="secondary" data-action="retry">Retry onboarding steps with stored token</button></p>`
      : "";

  return `<div data-poll="${isPolling(a) ? "1" : "0"}">
${alerts.join("\n")}
<div class="card">
  <h2>Connection</h2>
  <table>
    <tr><th>Status</th><td>${statusBadge}</td></tr>
    <tr><th>Messaging account (WABA) ID</th><td class="mono">${escapeHtml(a.wabaId ?? "—")}</td></tr>
    <tr><th>Phone number ID</th><td class="mono">${escapeHtml(a.phoneNumberId ?? "—")}</td></tr>
    <tr><th>Display number</th><td>${escapeHtml(a.displayPhoneNumber ?? "—")}</td></tr>
    <tr><th>App subscribed to WABA</th><td>${a.subscribedAt ? `${badge("ok", "yes")} ${fmtDate(a.subscribedAt)}` : badge("", "no")}</td></tr>
    <tr><th>Coexistence check</th><td>${coex}</td></tr>
    <tr><th>Onboarded at</th><td>${fmtDate(a.onboardedAt)}</td></tr>
    <tr><th>Last signup event</th><td class="mono">${escapeHtml(session?.event ?? "—")}</td></tr>
  </table>
  ${retry}
</div>
<div class="card">
  <h2>WhatsApp Business app data sync</h2>
  <table>
    ${syncRow("Contacts sync", "contacts", a.contactsSyncStartedAt, a.contactsSyncRequestId, a.contactsSyncInFlightAt, a.contactsSyncLastError, canStartSync)}
    ${syncRow("History sync", "history", a.historySyncStartedAt, a.historySyncRequestId, a.historySyncInFlightAt, a.historySyncLastError, canStartSync, historyExtra)}
  </table>
  <p class="muted">Each sync can only succeed once per onboarding. Buttons stay enabled only for a retry after a failed attempt.</p>
</div>
</div>`;
}
