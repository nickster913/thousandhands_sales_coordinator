/**
 * Encrypt a secret with the same AES-256-GCM payload that getBusinessToken decrypts.
 * Reads the plaintext from stdin so it is not stored in argv, shell history, or this repo.
 *
 * Uses ENCRYPTION_KEY from .env. That must be the key the server will decrypt with.
 */
import { decryptSecret, encryptSecret } from "../src/lib/crypto";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const token = await readStdin();
  if (!token) {
    console.error("No token on stdin. Example: npm run encrypt-token < token.txt");
    process.exit(1);
  }
  const payload = encryptSecret(token);
  if (decryptSecret(payload) !== token) {
    console.error("Round-trip check failed; ciphertext was not printed.");
    process.exit(1);
  }
  process.stdout.write(`${payload}\n`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
