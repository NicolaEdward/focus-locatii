import { createHash } from "node:crypto";

// A fixed-order caller-owned object is hashed; the key identifies one intent,
// not an arbitrary permission to execute another payment on a later retry.
export function financialRequestFingerprint(input: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(input)))
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function")
      return canonicalValue(value.toJSON());
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function assertSameFinancialIntent(
  existing: unknown,
  fingerprint: string,
) {
  if (existing !== fingerprint)
    throw new Error(
      "Cheia operației a fost deja folosită pentru alte date. Verifică istoricul înainte de o operație nouă.",
    );
}
