import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { encryptSecret } from "../src/lib/crypto";
import { prisma } from "../src/lib/db";
import { ACCOUNT_ID } from "../src/whatsapp/account";
import { BUSINESS_TOKEN, PHONE_ID, WABA_ID } from "./fakeGraph";

export async function startApp(): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function login(base: string, password = process.env.ADMIN_PASSWORD!): Promise<Response> {
  return fetch(`${base}/admin/login`, {
    method: "POST",
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
}

/** Connected coexistence account so the AI reply path can send via Graph. */
export async function seedConnectedAccount() {
  await prisma.whatsappAccount.upsert({
    where: { id: ACCOUNT_ID },
    create: {
      id: ACCOUNT_ID,
      status: "connected",
      wabaId: WABA_ID,
      phoneNumberId: PHONE_ID,
      businessTokenEncrypted: encryptSecret(BUSINESS_TOKEN),
      onboardedAt: new Date(),
    },
    update: {
      status: "connected",
      wabaId: WABA_ID,
      phoneNumberId: PHONE_ID,
      businessTokenEncrypted: encryptSecret(BUSINESS_TOKEN),
      onboardedAt: new Date(),
    },
  });
}
