import assert from "node:assert/strict";
import { test } from "node:test";
import { messagesToTurns } from "../src/ai/conversation";
import { completeReply } from "../src/ai/claude";

test("messagesToTurns maps fromMe, merges consecutive roles, drops leading assistant", () => {
  const turns = messagesToTurns([
    { fromMe: true, type: "text", text: "Welcome" },
    { fromMe: false, type: "text", text: "Hi" },
    { fromMe: false, type: "text", text: "20 ctn A" },
    { fromMe: true, type: "text", text: "How many?" },
    { fromMe: false, type: "image", text: "PO photo" },
    { fromMe: false, type: "text", text: "" },
  ]);
  assert.deepEqual(turns, [
    { role: "user", content: "Hi\n20 ctn A" },
    { role: "assistant", content: "How many?" },
    { role: "user", content: "[image] PO photo" },
  ]);
});

test("completeReply rejects a conversation that does not end on the user", async () => {
  await assert.rejects(() => completeReply([]), /ending in a user message/);
  await assert.rejects(
    () => completeReply([{ role: "assistant", content: "Hi" }]),
    /ending in a user message/,
  );
});
