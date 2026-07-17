import { Prisma } from "@prisma/client";

export const DAY_MS = 86_400_000;

export function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

export function decimalString(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null || value === "") return "0.00";
  return new Prisma.Decimal(value).toFixed(2);
}

export function daysFromToday(value: Date, today: Date) {
  return Math.floor((startOfUtcDay(value).getTime() - today.getTime()) / DAY_MS);
}
