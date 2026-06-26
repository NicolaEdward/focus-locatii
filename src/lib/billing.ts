import { calculateProrata } from "@/lib/prorata";
import { roundMoney } from "@/lib/money";

export const paymentTermOptions = ["advance", "7_days", "15_days", "30_days", "45_days", "custom"] as const;
export const billingRules = [
  "campaign_start",
  "campaign_end",
  "month_start",
  "month_end",
  "monthly_in_advance",
  "monthly_after_service",
  "upfront_on_contract",
  "upfront_before_campaign_start",
  "fixed_custom_date",
  "manual_per_contract"
] as const;
export const billingFrequencies = ["once", "monthly", "custom"] as const;

export type BillingRule = (typeof billingRules)[number];
export type BillingFrequency = (typeof billingFrequencies)[number];

export type BillingInput = {
  periodStart: Date;
  periodEnd: Date;
  monthlyAmount: number;
  currency?: string | null;
  companyEntity?: string | null;
  billingRule?: string | null;
  billingFrequency?: string | null;
  paymentTermDays?: number | null;
  billingDayOfMonth?: number | null;
  customBillingDate?: Date | null;
  bookedAt?: Date | null;
  createdAt?: Date | null;
};

export type BillingItemDraft = {
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  invoiceDate: Date;
  dueDate: Date;
  amount: number;
  currency: string;
  billingRule: string;
  paymentTermDays: number;
};

export function paymentTermDays(type?: string | null, customDays?: number | null) {
  if (customDays != null && customDays >= 0) return customDays;
  if (type === "advance") return 0;
  if (type === "7_days") return 7;
  if (type === "15_days") return 15;
  if (type === "30_days") return 30;
  if (type === "45_days") return 45;
  return 30;
}

export function calculateBillingItems(input: BillingInput): BillingItemDraft[] {
  if (input.periodStart > input.periodEnd) return [];
  const currency = input.currency === "RON" || input.currency === "EUR" ? input.currency : "EUR";
  const rule = normalizeBillingRule(input.billingRule);
  const frequency = normalizeBillingFrequency(input.billingFrequency, rule);
  const termDays = Math.max(0, Number(input.paymentTermDays ?? 30));
  const periods = frequency === "monthly" ? monthlyPeriods(input.periodStart, input.periodEnd) : [{ start: input.periodStart, end: input.periodEnd }];

  return periods.map((period) => {
    const amount = frequency === "monthly"
      ? calculateProrata(input.monthlyAmount, input.periodStart, input.periodEnd, period.start, period.end).amount
      : totalContractValue(input.monthlyAmount, input.periodStart, input.periodEnd);
    const invoiceDate = calculateInvoiceDate({
      rule,
      periodStart: period.start,
      periodEnd: period.end,
      campaignStart: input.periodStart,
      campaignEnd: input.periodEnd,
      billingDayOfMonth: input.billingDayOfMonth,
      customBillingDate: input.customBillingDate,
      bookedAt: input.bookedAt,
      createdAt: input.createdAt
    });
    return {
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      invoiceDate,
      dueDate: addDays(invoiceDate, termDays),
      amount: roundMoney(amount),
      currency,
      billingRule: rule,
      paymentTermDays: termDays
    };
  }).filter((item) => item.amount > 0);
}

export async function syncBillingItemsForReservations(reservationIds: string[]) {
  void reservationIds;
  return [];
}

function normalizeBillingRule(value?: string | null): BillingRule {
  return billingRules.includes(value as BillingRule) ? value as BillingRule : "month_start";
}

function normalizeBillingFrequency(value: string | null | undefined, rule: BillingRule): BillingFrequency {
  if (billingFrequencies.includes(value as BillingFrequency)) return value as BillingFrequency;
  return rule === "monthly_in_advance" || rule === "monthly_after_service" || rule === "month_start" || rule === "month_end" ? "monthly" : "once";
}

function calculateInvoiceDate(input: {
  rule: BillingRule;
  periodStart: Date;
  periodEnd: Date;
  campaignStart: Date;
  campaignEnd: Date;
  billingDayOfMonth?: number | null;
  customBillingDate?: Date | null;
  bookedAt?: Date | null;
  createdAt?: Date | null;
}) {
  if (input.rule === "fixed_custom_date" && input.customBillingDate) return startOfDay(input.customBillingDate);
  if (input.rule === "manual_per_contract") return startOfDay(input.customBillingDate || input.periodStart);
  if (input.rule === "campaign_start") return startOfDay(input.campaignStart);
  if (input.rule === "campaign_end") return startOfDay(input.campaignEnd);
  if (input.rule === "upfront_on_contract") return startOfDay(input.bookedAt || input.createdAt || input.campaignStart);
  if (input.rule === "upfront_before_campaign_start") return startOfDay(input.customBillingDate || input.campaignStart);
  if (input.rule === "month_end" || input.rule === "monthly_after_service") return startOfDay(input.periodEnd);
  return billingDayInMonth(input.periodStart, input.billingDayOfMonth || 1);
}

function monthlyPeriods(start: Date, end: Date) {
  const periods: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    periods.push({
      start: start > monthStart ? start : monthStart,
      end: end < monthEnd ? end : monthEnd
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return periods;
}

function totalContractValue(monthlyAmount: number, start: Date, end: Date) {
  return monthlyPeriods(start, end).reduce((sum, period) => {
    return sum + calculateProrata(monthlyAmount, start, end, period.start, period.end).amount;
  }, 0);
}

function billingDayInMonth(date: Date, day: number) {
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), Math.min(Math.max(1, day), daysInMonth)));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
