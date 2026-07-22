import crypto from "node:crypto";

export function authSecret() {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "focus-media-local-development-secret-change-me";
  throw new Error("AUTH_SECRET trebuie sa aiba minimum 32 de caractere.");
}

export function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

export function securityHash(scope: string, value: string) {
  return crypto.createHmac("sha256", authSecret()).update(`${scope}:${value}`).digest("hex");
}

export function randomOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
