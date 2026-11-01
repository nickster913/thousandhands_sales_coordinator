import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";

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
