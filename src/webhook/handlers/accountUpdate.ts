import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { logger } from "../../lib/logger";
import { ACCOUNT_ID } from "../../whatsapp/account";
import { asRecord } from "../types";
import type { Json } from "../types";

const DISCONNECT_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_DELETED"]);

export async function handleAccountUpdate(value: Json): Promise<void> {
  const event = typeof value.event === "string" ? value.event : "unknown";
  const disconnectionInfo = value.disconnection_info ? asRecord(value.disconnection_info) : null;
  logger.info("account_update", { event, hasDisconnectionInfo: Boolean(disconnectionInfo) });

  const lastAccountEvent = value as Prisma.InputJsonValue;
  const status = DISCONNECT_EVENTS.has(event) ? "disconnected" : event === "ACCOUNT_RECONNECTED" ? "connected" : undefined;
  const disconnection =
    DISCONNECT_EVENTS.has(event) && disconnectionInfo
      ? (disconnectionInfo as Prisma.InputJsonValue)
      : event === "ACCOUNT_RECONNECTED"
        ? Prisma.DbNull
        : undefined;

  await prisma.whatsappAccount.upsert({
    where: { id: ACCOUNT_ID },
    create: {
      id: ACCOUNT_ID,
      lastAccountEvent,
      ...(status ? { status } : {}),
      ...(disconnectionInfo ? { disconnectionInfo: disconnectionInfo as Prisma.InputJsonValue } : {}),
    },
    update: {
      lastAccountEvent,
      ...(status ? { status } : {}),
      ...(disconnection !== undefined ? { disconnectionInfo: disconnection } : {}),
    },
  });
}
