import { logger } from "../../lib/logger";
import { onInboundCustomerMessage } from "../../orders/pipeline";
import { digits } from "../../lib/phone";
import { asArray, unixToDate } from "../types";
import type { Json, WaContact, WaMessage, WaStatus } from "../types";
import {
  applyDeliveryStatus,
  markEdited,
  markRevoked,
  touchInboundChat,
  upsertContactProfile,
  upsertMessage,
  waMessageToRow,
} from "../store";

/** Error 131060 on type=unsupported is expected for some coexistence traffic. Do not reply. */
function isUnsupported(msg: WaMessage): boolean {
  if (msg.type === "unsupported") return true;
  return asArray<{ code?: number }>(msg.errors).some((e) => e.code === 131060);
}

export async function handleMessages(value: Json): Promise<void> {
  const contacts = asArray<WaContact>(value.contacts);
  const nameByWaId = new Map(contacts.map((c) => [digits(c.wa_id), c.profile?.name ?? ""]));

  for (const msg of asArray<WaMessage>(value.messages)) {
    const contactPhone = digits(msg.from);
    const profileName = nameByWaId.get(contactPhone);
    if (profileName) await upsertContactProfile(contactPhone, profileName);

    if (msg.type === "edit") {
      const original = msg.edit?.original_message_id;
      if (original) await markEdited(original, msg);
      else logger.warn("Edit webhook missing original_message_id");
      continue;
    }
    if (msg.type === "revoke") {
      const original = msg.revoke?.original_message_id;
      if (original) await markRevoked(original);
      else logger.warn("Revoke webhook missing original_message_id");
      continue;
    }

    const { created } = await upsertMessage(
      waMessageToRow(msg, { contactPhone, direction: "in", fromMe: false }),
    );
    if (msg.timestamp) await touchInboundChat(contactPhone, unixToDate(msg.timestamp));

    if (isUnsupported(msg)) {
      logger.info("Unsupported inbound message (expected on coexistence for some types)", {
        type: msg.type,
        errorCode: asArray<{ code?: number }>(msg.errors)[0]?.code,
      });
      continue;
    }

    await onInboundCustomerMessage({
      wamid: msg.id ?? "",
      contactPhone,
      type: msg.type ?? "unknown",
      created,
    });
  }

  for (const status of asArray<WaStatus>(value.statuses)) {
    await applyDeliveryStatus(status.id ?? "", status.status);
    if (status.errors?.length) {
      logger.warn("Outgoing message status error", { status: status.status, code: status.errors[0]?.code });
    }
  }
}
