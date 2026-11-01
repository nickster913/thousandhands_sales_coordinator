import { prisma } from "../../lib/db";
import { logger } from "../../lib/logger";
import { digits, samePhone } from "../../lib/phone";
import { ACCOUNT_ID } from "../../whatsapp/account";
import { asArray, asRecord } from "../types";
import type { Json, WaMessage } from "../types";
import { upsertMessage, waMessageToRow } from "../store";

const HISTORY_DECLINED = 2593109;

type HistoryChunk = {
  errors?: { code?: number }[];
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id?: string; messages?: WaMessage[] }[];
};

export async function handleHistory(value: Json): Promise<void> {
  const businessNumber = digits(asRecord(value.metadata).display_phone_number);
  let declined = false;
  let maxProgress: number | null = null;

  for (const chunk of asArray<HistoryChunk>(value.history)) {
    if (asArray<{ code?: number }>(chunk.errors).some((e) => e.code === HISTORY_DECLINED)) {
      declined = true;
      logger.info("History sync declined by the business", { code: HISTORY_DECLINED });
      continue;
    }

    const progress = chunk.metadata?.progress;
    if (typeof progress === "number") maxProgress = Math.max(maxProgress ?? 0, progress);

    for (const thread of asArray<{ id?: string; messages?: WaMessage[] }>(chunk.threads)) {
      const contactPhone = digits(thread.id);
      for (const msg of asArray<WaMessage>(thread.messages)) {
        const fromMe = samePhone(msg.from, businessNumber);
        await upsertMessage(
          waMessageToRow(msg, { contactPhone: contactPhone || digits(fromMe ? msg.to : msg.from), direction: "history", fromMe }),
        );
      }
    }
  }

  if (declined || maxProgress !== null) {
    await prisma.whatsappAccount.upsert({
      where: { id: ACCOUNT_ID },
      create: {
        id: ACCOUNT_ID,
        historySyncDeclined: declined,
        historySyncProgress: maxProgress,
      },
      update: {
        ...(declined ? { historySyncDeclined: true } : {}),
        ...(maxProgress !== null ? { historySyncProgress: maxProgress } : {}),
      },
    });
  }
}
