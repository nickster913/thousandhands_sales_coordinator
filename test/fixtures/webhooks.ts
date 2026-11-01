/** Payloads match Meta's documented examples (messages, coexistence history/echoes/state_sync, account_update). */

export const WABA_ID = "102290129340398";
export const PHONE_ID = "106540352242922";
export const CUSTOMER = "16505551234";
export const BUSINESS_DISPLAY = "15550783881";
export const TEXT_WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=";
export const STATUS_WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA";
export const ECHO_WAMID = "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA";
export const ORIGINAL_WAMID = "wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=";
export const EDIT_WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=";
export const HISTORY_WAMID = "wamid.N0FCNjMAHBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0";
export const PLACEHOLDER_WAMID = "wamid.QyNUEHBgLMTY0NjcwNDM1OTUVAgARGBI1Rj3NEYxMzAzMzQ5MkEA";

function wrap(field: string, value: unknown, entryId = WABA_ID) {
  return { object: "whatsapp_business_account", entry: [{ id: entryId, changes: [{ field, value }] }] };
}

export const inboundText = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: CUSTOMER }],
  messages: [
    {
      from: CUSTOMER,
      id: TEXT_WAMID,
      timestamp: "1749416383",
      type: "text",
      text: { body: "20 ctn item A please" },
    },
  ],
});

export const inboundImage = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: CUSTOMER }],
  messages: [
    {
      from: CUSTOMER,
      id: "wamid.image-1",
      timestamp: "1749416400",
      type: "image",
      image: { caption: "PO photo", mime_type: "image/jpeg", id: "24230790383178626" },
    },
  ],
});

export const inboundUnsupported = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  messages: [
    {
      from: CUSTOMER,
      id: "wamid.unsupported-1",
      timestamp: "1749416410",
      type: "unsupported",
      errors: [{ code: 131060, title: "Message type unknown" }],
    },
  ],
});

export const inboundEdit = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  messages: [
    {
      from: CUSTOMER,
      id: EDIT_WAMID,
      timestamp: "1749854575",
      type: "edit",
      edit: {
        original_message_id: TEXT_WAMID,
        message: { type: "text", text: { body: "20 ctn item A, 5 drum B" } },
      },
    },
  ],
});

export const inboundRevoke = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  messages: [
    {
      from: CUSTOMER,
      id: "wamid.revoke-1",
      timestamp: "1749854575",
      type: "revoke",
      revoke: { original_message_id: TEXT_WAMID },
    },
  ],
});

export const deliveredStatus = wrap("messages", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  statuses: [
    {
      id: STATUS_WAMID,
      status: "delivered",
      timestamp: "1750263773",
      recipient_id: CUSTOMER,
    },
  ],
});

export const smbEcho = wrap("smb_message_echoes", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  message_echoes: [
    {
      from: BUSINESS_DISPLAY,
      to: CUSTOMER,
      id: ECHO_WAMID,
      timestamp: "1700255121",
      type: "text",
      text: { body: "On it" },
    },
  ],
});

export const historyChunk = wrap("history", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 55 },
      threads: [
        {
          id: CUSTOMER,
          messages: [
            {
              from: BUSINESS_DISPLAY,
              id: ECHO_WAMID,
              timestamp: "1739230955",
              type: "text",
              text: { body: "Here's the info you requested!" },
              history_context: { status: "read" },
            },
            {
              from: BUSINESS_DISPLAY,
              id: PLACEHOLDER_WAMID,
              timestamp: "1739230970",
              type: "media_placeholder",
              history_context: { status: "played" },
            },
            {
              from: CUSTOMER,
              id: HISTORY_WAMID,
              timestamp: "1739230970",
              type: "text",
              text: { body: "Thanks!" },
              history_context: { status: "read" },
            },
          ],
        },
      ],
    },
  ],
});

export const historyMediaFollowup = wrap("history", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  history: [
    {
      metadata: { phase: 0, chunk_order: 2, progress: 100 },
      threads: [
        {
          id: CUSTOMER,
          messages: [
            {
              from: BUSINESS_DISPLAY,
              id: PLACEHOLDER_WAMID,
              timestamp: "1739230970",
              type: "image",
              image: { caption: "Black Prince echeveria", mime_type: "image/jpeg", id: "24230790383178626" },
            },
          ],
        },
      ],
    },
  ],
});

export const historyDeclined = wrap("history", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  history: [
    {
      errors: [
        {
          code: 2593109,
          title: "History sync is turned off by the business from the WhatsApp Business App",
          message: "History sync is turned off by the business from the WhatsApp Business App",
        },
      ],
    },
  ],
});

export const contactsAdd = wrap("smb_app_state_sync", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  state_sync: [
    {
      type: "contact",
      action: "add",
      contact: { full_name: "Pablo Morales", first_name: "Pablo", phone_number: CUSTOMER },
      metadata: { timestamp: "1738346006" },
    },
  ],
});

export const contactsRemove = wrap("smb_app_state_sync", {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: BUSINESS_DISPLAY, phone_number_id: PHONE_ID },
  state_sync: [
    {
      type: "contact",
      action: "remove",
      contact: { phone_number: CUSTOMER },
      metadata: { timestamp: "1738347006" },
    },
  ],
});

export const partnerRemoved = wrap(
  "account_update",
  {
    event: "PARTNER_REMOVED",
    waba_info: { waba_id: WABA_ID, owner_business_id: "2329417887457253" },
    disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" },
  },
  "2949482758682047",
);

export const accountOffboarded = wrap("account_update", { event: "ACCOUNT_OFFBOARDED" });
export const accountReconnected = wrap("account_update", { event: "ACCOUNT_RECONNECTED" });
