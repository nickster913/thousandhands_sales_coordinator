import assert from "node:assert/strict";
import { test } from "node:test";
import type { WhatsappAccount } from "@prisma/client";
import { isPolling, renderStatusCard } from "../src/admin/statusCard";

function account(over: Partial<WhatsappAccount> = {}): WhatsappAccount {
  return {
    id: 1,
    wabaId: "102290129340398",
    businessId: null,
    phoneNumberId: "106540352242922",
    displayPhoneNumber: "+65 8123 4567",
    businessTokenEncrypted: "v1:x",
    subscribedAt: new Date("2026-11-01T00:00:00Z"),
    onboardingLastError: null,
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
    isOnBizApp: true,
    platformType: "CLOUD_API",
    onboardedAt: new Date("2026-11-01T00:00:00Z"),
    status: "connected",
    lastSessionEvent: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" },
    disconnectionInfo: null,
    lastAccountEvent: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  };
}

test("status card shows 24h remaining and enables sync buttons before a successful start", () => {
  const now = Date.parse("2026-11-01T03:00:00Z");
  const html = renderStatusCard(account(), now);
  assert.match(html, /21h 0m left/);
  assert.match(html, /connected/);
  assert.match(html, /is_on_biz_app=true/);
  assert.doesNotMatch(html, /disabled>Start contacts/);
  assert.doesNotMatch(html, /<script/i);
});

test("status card disables sync buttons after a successful start and shows request_id", () => {
  const html = renderStatusCard(
    account({
      contactsSyncStartedAt: new Date("2026-11-01T00:05:00Z"),
      contactsSyncRequestId: "req-abc",
    }),
    Date.parse("2026-11-01T03:00:00Z"),
  );
  assert.match(html, /disabled>Start contacts/);
  assert.match(html, /request_id req-abc/);
});

test("status card warns when the 24h window has passed", () => {
  const html = renderStatusCard(account(), Date.parse("2026-11-02T01:00:00Z"));
  assert.match(html, /24-hour sync window has passed/);
});

test("status card highlights PARTNER_REMOVED / disconnected", () => {
  const html = renderStatusCard(account({ status: "disconnected", disconnectionInfo: { event: "PARTNER_REMOVED" } }));
  assert.match(html, /Disconnected from Cloud API/);
  assert.match(html, /PARTNER_REMOVED/);
});

test("status card polls while history sync is in progress", () => {
  assert.equal(isPolling(account({ historySyncStartedAt: new Date(), historySyncProgress: 40 })), true);
  assert.equal(isPolling(account({ historySyncStartedAt: new Date(), historySyncProgress: 100 })), false);
});
