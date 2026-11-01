import { digits } from "../../lib/phone";
import { asArray } from "../types";
import type { Json, WaMessage } from "../types";
import { markHumanTakeover, upsertMessage, waMessageToRow } from "../store";

/**
 * smb_message_echoes: messages sent from the WhatsApp Business app (or a supported companion).
 * Cloud API sends do not appear here. contactPhone is `to`.
 */
export async function handleMessageEchoes(value: Json): Promise<void> {
  for (const msg of asArray<WaMessage>(value.message_echoes)) {
    const contactPhone = digits(msg.to);
    await upsertMessage(waMessageToRow(msg, { contactPhone, direction: "out_human", fromMe: true }));
    await markHumanTakeover(contactPhone);
  }
}
