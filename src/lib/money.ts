import { Prisma } from "@prisma/client";

export type MoneyInput = number | string | Prisma.Decimal | null | undefined;

export function moneyNumber(value: MoneyInput) {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function moneyDecimal(value: MoneyInput) {
  return new Prisma.Decimal(roundMoney(moneyNumber(value)));
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isCurrency(value: unknown): value is "RON" | "EUR" {
  return value === "RON" || value === "EUR";
}
