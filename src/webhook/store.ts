import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { digits } from "../lib/phone";
import type { WaMessage } from "./types";
import { messageText, unixToDate } from "./types";

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  played: 2,
  read: 3,
  failed: 4,
};

export function upsertContactProfile(phone: string, profileName?: string | null) {
  const phoneNumber = digits(phone);
  if (!phoneNumber) return Promise.resolve();
  return prisma.contact.upsert({
    where: { phoneNumber },
    create: { phoneNumber, profileName: profileName ?? null, removed: false },
    update: {
      ...(profileName ? { profileName } : {}),
      removed: false,
    },
  });
}

export async function upsertMessage(input: {
  wamid: string;
  contactPhone: string;
  direction: "in" | "out_bot" | "out_human" | "history";
  fromMe: boolean;
  type: string;
  text: string | null;
  raw: unknown;
  timestamp: Date;
  status?: string | null;
}): Promise<{ created: boolean }> {
  const contactPhone = digits(input.contactPhone);
  if (!input.wamid || !contactPhone) return { created: false };

  try {
    await prisma.message.create({
      data: {
        wamid: input.wamid,
        contactPhone,
        direction: input.direction,
        fromMe: input.fromMe,
        type: input.type,
        text: input.text,
        rawJson: input.raw as Prisma.InputJsonValue,
        timestamp: input.timestamp,
        status: input.status ?? null,
      },
    });
    return { created: true };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    // Same wamid: keep the first direction. A later history media payload replaces a placeholder.
    if (input.type !== "media_placeholder") {
      await prisma.message.update({
        where: { wamid: input.wamid },
        data: {
          type: input.type,
          ...(input.text != null ? { text: input.text } : {}),
          rawJson: input.raw as Prisma.InputJsonValue,
        },
      });
    }
    return { created: false };
  }
}

export function touchInboundChat(contactPhone: string, at: Date) {
  const phone = digits(contactPhone);
  if (!phone) return Promise.resolve();
  return prisma.chatState.upsert({
    where: { contactPhone: phone },
    create: { contactPhone: phone, lastCustomerMessageAt: at, aiEnabled: true },
    update: { lastCustomerMessageAt: at },
  });
}

export function markHumanTakeover(contactPhone: string, at = new Date()) {
  const phone = digits(contactPhone);
  if (!phone) return Promise.resolve();
  return prisma.chatState.upsert({
    where: { contactPhone: phone },
    create: { contactPhone: phone, humanTakeoverAt: at, aiEnabled: true },
    update: { humanTakeoverAt: at },
  });
}

export async function applyDeliveryStatus(wamid: string, status: string | undefined) {
  if (!wamid || !status) return;
  const next = status.toLowerCase();
  const existing = await prisma.message.findUnique({ where: { wamid }, select: { status: true } });
  if (!existing) return;
  const prevRank = existing.status ? (STATUS_RANK[existing.status] ?? -1) : -1;
  const nextRank = STATUS_RANK[next] ?? -1;
  if (nextRank < prevRank) return;
  await prisma.message.update({ where: { wamid }, data: { status: next } });
}

export async function markEdited(originalWamid: string, edit: WaMessage) {
  const nested = edit.edit?.message;
  const text = messageText(nested) ?? messageText(edit);
  await prisma.message.updateMany({
    where: { wamid: originalWamid },
    data: { edited: true, ...(text != null ? { text } : {}), rawJson: edit as Prisma.InputJsonValue },
  });
}

export async function markRevoked(originalWamid: string) {
  await prisma.message.updateMany({ where: { wamid: originalWamid }, data: { revoked: true } });
}

export function waMessageToRow(
  msg: WaMessage,
  extras: { contactPhone: string; direction: "in" | "out_bot" | "out_human" | "history"; fromMe: boolean },
) {
  return {
    wamid: msg.id ?? "",
    contactPhone: extras.contactPhone,
    direction: extras.direction,
    fromMe: extras.fromMe,
    type: msg.type ?? "unknown",
    text: messageText(msg),
    raw: msg,
    timestamp: unixToDate(msg.timestamp),
    status: msg.history_context?.status ?? null,
  };
}
