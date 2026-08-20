import { Prisma } from "@prisma/client";

type MoneyInput = Prisma.Decimal | string | number | null | undefined;

export function receivableAdjustmentTotal(rawRowJson: unknown) {
  return receivableAdjustmentEntries(rawRowJson).reduce((total, entry) => total.plus(entry.amount), new Prisma.Decimal(0));
}

export function receivableAdjustmentEntries(rawRowJson: unknown) {
  const raw = rawRowJson && typeof rawRowJson === "object" && !Array.isArray(rawRowJson)
    ? rawRowJson as Record<string, unknown>
    : null;
  const entries = Array.isArray(raw?.smartBillAdjustments) ? raw.smartBillAdjustments : [];
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    const key = String(value.adjustmentReceivableId || value.smartBillDedupeKey || `row:${index}`);
    if (seen.has(key)) return [];
    seen.add(key);
    const amount = decimal(value.adjustmentAmount);
    return amount.greaterThan(0) ? [{
      key,
      receivableId: typeof value.adjustmentReceivableId === "string" ? value.adjustmentReceivableId : null,
      amount
    }] : [];
  });
}

export function receivableNetAmount(invoicedAmount: MoneyInput, rawRowJson: unknown) {
  return Prisma.Decimal.max(decimal(invoicedAmount).minus(receivableAdjustmentTotal(rawRowJson)), 0);
}

export function receivableNetRemaining(input: {
  invoicedAmount: MoneyInput;
  collectedAmount: MoneyInput;
  rawRowJson: unknown;
}) {
  return Prisma.Decimal.max(receivableNetAmount(input.invoicedAmount, input.rawRowJson).minus(decimal(input.collectedAmount)), 0);
}

function decimal(value: unknown) {
  try {
    return new Prisma.Decimal(value == null || value === "" ? 0 : value as Prisma.Decimal.Value);
  } catch {
    return new Prisma.Decimal(0);
  }
}
