import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../paths.ts";

/**
 * Encrypted, on-device store for provider secrets (API keys, local URLs).
 *
 * Local-first & private: secrets live only on this machine, encrypted at rest
 * with AES-256-GCM under a machine-local 256-bit key generated on first run and
 * stored 0600. Values are only ever handed to the provider they belong to and
 * are never logged, and never leave via any API (routes expose presence only).
 */

const SECRET_PATH = join(DATA_DIR, "secret.key");
const STORE_PATH = join(DATA_DIR, "keys.enc");

let secretKey: Buffer | null = null;
let cache: Record<string, string> | null = null;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function getSecret(): Buffer {
  if (secretKey) return secretKey;
  ensureDir();
  if (existsSync(SECRET_PATH)) {
    secretKey = readFileSync(SECRET_PATH);
  } else {
    secretKey = randomBytes(32);
    writeFileSync(SECRET_PATH, secretKey, { mode: 0o600 });
    chmodSync(SECRET_PATH, 0o600);
  }
  return secretKey;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecret(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getSecret(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function load(): Record<string, string> {
  if (cache) return cache;
  ensureDir();
  let data: Record<string, string> = {};
  if (existsSync(STORE_PATH)) {
    try {
      data = JSON.parse(decrypt(readFileSync(STORE_PATH, "utf8")));
    } catch {
      // Corrupt or unreadable store — start clean rather than crash.
      data = {};
    }
  }
  cache = data;
  return data;
}

function persist(): void {
  ensureDir();
  writeFileSync(STORE_PATH, encrypt(JSON.stringify(load())), { mode: 0o600 });
}

export function hasSecret(id: string): boolean {
  return Boolean(load()[id]);
}

/** Never expose over any route — for provider use inside the backend only. */
export function getSecretValue(id: string): string | undefined {
  return load()[id];
}

export function setSecret(id: string, value: string): void {
  load()[id] = value;
  persist();
}

export function deleteSecret(id: string): void {
  const store = load();
  delete store[id];
  persist();
}
