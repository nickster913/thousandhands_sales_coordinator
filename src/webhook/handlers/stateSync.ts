import { prisma } from "../../lib/db";
import { digits } from "../../lib/phone";
import { asArray, asRecord } from "../types";
import type { Json } from "../types";

type StateSync = {
  type?: string;
  action?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
};

export async function handleStateSync(value: Json): Promise<void> {
  for (const item of asArray<StateSync>(value.state_sync)) {
    if (item.type !== "contact") continue;
    const phoneNumber = digits(item.contact?.phone_number);
    if (!phoneNumber) continue;
    const contact = asRecord(item.contact);

    if (item.action === "remove") {
      await prisma.contact.upsert({
        where: { phoneNumber },
        create: { phoneNumber, removed: true },
        update: { removed: true },
      });
      continue;
    }

    if (item.action === "add") {
      await prisma.contact.upsert({
        where: { phoneNumber },
        create: {
          phoneNumber,
          fullName: typeof contact.full_name === "string" ? contact.full_name : null,
          firstName: typeof contact.first_name === "string" ? contact.first_name : null,
          removed: false,
        },
        update: {
          fullName: typeof contact.full_name === "string" ? contact.full_name : undefined,
          firstName: typeof contact.first_name === "string" ? contact.first_name : undefined,
          removed: false,
        },
      });
    }
  }
}
