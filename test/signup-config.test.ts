import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_EXTRAS } from "../src/admin/connectPage";
import { idsFromSessionEvent, sessionEventSchema } from "../src/whatsapp/onboarding";

test("FB.login extras are Embedded Signup v5 (coexistence on by default)", () => {
  assert.deepEqual(LOGIN_EXTRAS, { version: "v5" });
});

test("session event schema accepts the v4 coexistence payload (waba_id)", () => {
  const e = sessionEventSchema.parse({
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    version: 3,
    data: { waba_id: "102290129340398" },
  });
  assert.deepEqual(idsFromSessionEvent(e), { wabaId: "102290129340398", phoneNumberId: undefined, businessId: undefined });
});

test("session event schema accepts the v5 coexistence payload (messaging_account_ids)", () => {
  const e = sessionEventSchema.parse({
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    data: {
      phone_number_id: "106540352242922",
      is_on_biz_app: true,
      messaging_account_ids: ["102290129340398"],
      primary_waac_ids: [],
      business_id: "2729063490586005",
    },
  });
  assert.deepEqual(idsFromSessionEvent(e), {
    wabaId: "102290129340398",
    phoneNumberId: "106540352242922",
    businessId: "2729063490586005",
  });
});

test("session event schema rejects non-Embedded-Signup payloads", () => {
  assert.equal(sessionEventSchema.safeParse({ type: "OTHER", event: "FINISH" }).success, false);
  assert.equal(sessionEventSchema.safeParse({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "not-digits" } }).success, false);
});
