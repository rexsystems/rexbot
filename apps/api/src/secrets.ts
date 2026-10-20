import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDirectory } from "./db.js";

// Provider keys are encrypted at rest with AES-256-GCM. The key comes from REX_SECRET_KEY, or a random
// key generated once into <data>/secret.key (mode 0600). Losing that file makes saved keys unreadable;
// users then reconnect their providers.
let cached: Buffer | null = null;

function masterKey(): Buffer {
  if (cached) return cached;
  const configured = process.env.REX_SECRET_KEY?.trim();
  if (configured) {
    cached = createHash("sha256").update(configured).digest();
    return cached;
  }
  const file = path.join(dataDirectory(), "secret.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  cached = createHash("sha256").update(fs.readFileSync(file, "utf8").trim()).digest();
  return cached;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string | null {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "…a1b2" for showing which key is saved without revealing it. */
export function secretHint(plain: string): string | null {
  const trimmed = plain.trim();
  return trimmed ? `…${trimmed.slice(-4)}` : null;
}
