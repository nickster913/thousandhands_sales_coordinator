import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, safeEqual } from "../src/lib/crypto";
import { logger, textPreview } from "../src/lib/logger";

test("AES-256-GCM round trip, random IV, tamper detection", () => {
  const a = encryptSecret("EAAbusinesstoken");
  const b = encryptSecret("EAAbusinesstoken");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "EAAbusinesstoken");
  const parts = a.split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(parts.join(":")));
});

test("safeEqual", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("logger redacts tokens, OAuth codes and (in production) message text, keeps numeric error codes", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    logger.info("check", {
      access_token: "EAAsecret",
      code: "oauth-code",
      error: { code: 131060 },
      text: { body: "20 ctn item A" },
      url: "https://graph.facebook.com/x?access_token=abc&code=def",
      header: "Bearer abc.def",
    });
  } finally {
    console.log = orig;
  }
  const out = lines.join("\n");
  assert.doesNotMatch(out, /EAAsecret|oauth-code|20 ctn|access_token=abc|code=def|Bearer abc/);
  assert.match(out, /"code":131060/);
  assert.equal(textPreview("20 ctn item A"), "[13 chars]");
});
