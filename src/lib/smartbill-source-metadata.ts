import type { Prisma } from "@prisma/client";

// A source refresh owns only these fields. Canonical adjustments, fiscal
// attestations and any other application provenance belong to the ledger.
const SOURCE_KEYS = [
  "source", "companyName", "companyCode", "smartBillDedupeKey",
  "smartBillReportKind", "rowNumber", "sheetName", "fiscalCode",
  "normalizedFiscalCode", "sourceStatus", "spvIndex", "netAmount",
  "vatAmount", "totalAmount", "raw"
] as const;

export function mergeSmartBillSourceMetadata(existing: unknown, incoming: unknown): Prisma.InputJsonObject {
  const merged = { ...object(existing) };
  const source = object(incoming);
  for (const key of SOURCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) merged[key] = source[key];
  }
  return merged as Prisma.InputJsonObject;
}

export function hasUnresolvedSourceFiscalReview(raw: unknown) {
  return object(object(raw).sourceFiscalReview).status === "open";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
