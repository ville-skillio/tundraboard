import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-encryption-key";

// Derive a fixed-length 32-byte key so AES-256 always receives the right key size.
const KEY_BUFFER = Buffer.from(
  crypto.createHash("sha256").update(ENCRYPTION_KEY).digest(),
);

export function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  // Prepend IV so decryption is self-contained: "<iv-hex>:<ciphertext-hex>"
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(encrypted: string): string {
  const separatorIndex = encrypted.indexOf(":");
  const ivHex = encrypted.slice(0, separatorIndex);
  const ciphertext = encrypted.slice(separatorIndex + 1);
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function hashForComparison(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
