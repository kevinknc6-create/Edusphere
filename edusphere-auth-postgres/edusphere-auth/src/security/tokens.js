import crypto from "node:crypto";

/** Create a URL-safe random token. Only its SHA-256 is stored in the database. */
export function newToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

export const randomString = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
