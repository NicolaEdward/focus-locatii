import { Prisma } from "@prisma/client";
import { calculateBillingItems, type BillingInput, type BillingItemDraft } from "@/lib/billing";

type Rent = number | string | Prisma.Decimal;
export type RentalPriceSegmentInput = {
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  monthlyRent: Rent;
  currency: string;
};
export type PriceInterval = {
  periodStart: Date;
  periodEnd: Date;
  monthlyRent: Prisma.Decimal;
  currency: "RON" | "EUR";
};
type PriceScheduleInput = {
  periodStart: Date | string;
  periodEnd: Date | string;
  monthlyAmount: Rent;
  currency?: string | null;
};
const DAY = 86_400_000;

/** Calendar days are inclusive, as for availability and contractual prorata. */
export function getValidatedPriceIntervals(
  input: PriceScheduleInput,
  segments: readonly RentalPriceSegmentInput[] = [],
): { intervals: PriceInterval[]; valid: boolean; reasons: string[] } {
  const from = day(input.periodStart), to = day(input.periodEnd);
  if (!from || !to || from > to) return invalid("PRICE_SEGMENT_PERIOD_INVALID");
  const fallbackCurrency = currency(input.currency);
  if (!segments.length) {
    const rate = positiveRent(input.monthlyAmount);
    if (!fallbackCurrency) return invalid("PRICE_SEGMENT_CURRENCY_MISSING");
    if (!rate) return invalid("PRICE_SEGMENT_RENT_INVALID");
    return { valid: true, reasons: [], intervals: [{ periodStart: from, periodEnd: to, monthlyRent: rate, currency: fallbackCurrency }] };
  }
  const intervals: PriceInterval[] = [];
  for (const segment of segments) {
    const start = day(segment.effectiveFrom);
    const end = segment.effectiveTo == null ? to : day(segment.effectiveTo);
    const rate = positiveRent(segment.monthlyRent), unit = currency(segment.currency);
    if (!start || !end || start > end) return invalid("PRICE_SEGMENT_PERIOD_INVALID");
    if (!rate) return invalid("PRICE_SEGMENT_RENT_INVALID");
    if (!unit) return invalid("PRICE_SEGMENT_CURRENCY_MISSING");
    if (start > to || end < from) continue;
    intervals.push({ periodStart: new Date(Math.max(start.getTime(), from.getTime())), periodEnd: new Date(Math.min(end.getTime(), to.getTime())), monthlyRent: rate, currency: unit });
  }
  intervals.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  let next = from.getTime();
  for (const interval of intervals) {
    if (interval.periodStart.getTime() < next) return invalid("PRICE_SEGMENT_OVERLAP");
    if (interval.periodStart.getTime() > next) return invalid("PRICE_SEGMENT_GAP");
    next = interval.periodEnd.getTime() + DAY;
  }
  if (next !== to.getTime() + DAY) return invalid("PRICE_SEGMENT_GAP");
  // Currency changes need distinct contractual/fiscal instructions. Never add
  // RON and EUR or silently convert historical amounts into the current unit.
  if (new Set(intervals.map((part) => part.currency)).size !== 1 ||
      (fallbackCurrency && intervals.some((part) => part.currency !== fallbackCurrency))) {
    return invalid("PRICE_SEGMENT_CURRENCY_MISMATCH");
  }
  return { valid: true, reasons: [], intervals };
}

/** Sum physical-face shares first, then round once per contractual month. */
export function combinePriceIntervals(schedules: readonly (readonly PriceInterval[])[]): PriceInterval[] {
  const all = schedules.flat();
  const points = [...new Set(all.flatMap((part) => [part.periodStart.getTime(), part.periodEnd.getTime() + DAY]))].sort((a, b) => a - b);
  const result: PriceInterval[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index], end = points[index + 1] - DAY;
    const active = all.filter((part) => part.periodStart.getTime() <= start && part.periodEnd.getTime() >= end);
    if (!active.length) continue;
    if (new Set(active.map((part) => part.currency)).size !== 1) throw new Error("Nu se pot însuma prețuri în monede diferite.");
    result.push({ periodStart: new Date(start), periodEnd: new Date(end), monthlyRent: active.reduce((sum, part) => sum.plus(part.monthlyRent), new Prisma.Decimal(0)), currency: active[0].currency });
  }
  return result;
}

/** Round only after every segment's exact share of a calendar month is added. */
export function amountForPriceIntervals(intervals: readonly PriceInterval[], reportStart: Date | string, reportEnd: Date | string): number {
  const start = day(reportStart), end = day(reportEnd);
  if (!start || !end || start > end) throw new Error("Perioada de calcul nu este validă.");
  const months = new Map<string, Prisma.Decimal>();
  for (const interval of intervals) {
    const from = new Date(Math.max(interval.periodStart.getTime(), start.getTime()));
    const to = new Date(Math.min(interval.periodEnd.getTime(), end.getTime()));
    if (from > to) continue;
    let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    while (cursor <= to) {
      const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      const left = Math.max(from.getTime(), cursor.getTime()), right = Math.min(to.getTime(), last.getTime());
      const days = Math.floor((right - left) / DAY) + 1;
      const key = cursor.toISOString().slice(0, 7);
      months.set(key, (months.get(key) || new Prisma.Decimal(0)).plus(interval.monthlyRent.mul(days).div(last.getUTCDate())));
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
  }
  return [...months.values()].reduce((sum, amount) => sum.plus(amount.toDecimalPlaces(2)), new Prisma.Decimal(0)).toNumber();
}

export function calculateSegmentedBillingItems(input: BillingInput, segments: readonly RentalPriceSegmentInput[] = []): BillingItemDraft[] {
  const schedule = getValidatedPriceIntervals(input, segments);
  if (!schedule.valid) throw new Error(`Istoricul prețurilor necesită reconciliere înainte de facturare: ${schedule.reasons.join(", ")}.`);
  // A positive placeholder obtains the existing invoice/due-date calendar;
  // every draft's financial value comes exclusively from validated intervals.
  return calculateBillingItems({ ...input, monthlyAmount: 1, currency: schedule.intervals[0].currency }).map((item) => ({
    ...item,
    amount: amountForPriceIntervals(schedule.intervals, item.billingPeriodStart, item.billingPeriodEnd),
  }));
}

function invalid(reason: string) { return { valid: false, reasons: [reason], intervals: [] as PriceInterval[] }; }
function currency(value?: string | null) { return value === "RON" || value === "EUR" ? value : null; }
function positiveRent(value: Rent) {
  try { const amount = new Prisma.Decimal(value); return amount.isFinite() && amount.gt(0) ? amount : null; } catch { return null; }
}
function day(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const normalized = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) && normalized.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return normalized;
}
