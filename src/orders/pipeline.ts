import { logger } from "../lib/logger";

export type InboundOrderMessage = {
  wamid: string;
  contactPhone: string;
  type: string;
  created: boolean;
};

/**
 * Section D fills this in. Section C only persists the inbound message and calls here
 * for newly stored customer messages (not edits, revokes, unsupported, echoes, or history).
 */
export async function onInboundCustomerMessage(msg: InboundOrderMessage): Promise<void> {
  if (!msg.created) return;
  logger.info("Inbound message queued for order pipeline", { wamid: msg.wamid, type: msg.type });
}
