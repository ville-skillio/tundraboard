import crypto from "crypto";

// BUG #6 (PLANTED): Uses deprecated crypto.createCipher (removed in Node.js 22)
// instead of crypto.createCipheriv with an explicit IV.
// Also: using encryption for token generation is wrong — should use
// crypto.randomBytes or a proper token library
export function generateResetToken(userId: string): string {
  const cipher = crypto.createCipher("aes-256-cbc", "reset-token-secret");
  let encrypted = cipher.update(userId, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
