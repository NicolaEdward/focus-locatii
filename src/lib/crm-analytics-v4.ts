import { crmCurrentOpportunityValue, crmForecastForStage, type CrmForecastLevel } from "@/lib/crm-domain";

type OpportunityMetricInput = {
  stage: string;
  currency?: string | null;
  quotedValue?: unknown;
  revisedValue?: unknown;
  agreedValue?: unknown;
};

export type CrmCurrencyTotals = Record<string, number>;

export type CrmOpportunityAggregate = {
  stage: string;
  currency?: string | null;
  total?: unknown;
};

export function crmOpportunityTotals(rows: readonly OpportunityMetricInput[]) {
  const totals: Record<CrmForecastLevel, CrmCurrencyTotals> = {
    pipeline: {},
    possible: {},
    commit: {},
    won: {},
    excluded: {}
  };
  for (const row of rows) {
    const value = crmCurrentOpportunityValue(row);
    const currency = row.currency?.trim().toUpperCase();
    if (value == null || !currency) continue;
    const level = crmForecastForStage(row.stage);
    totals[level][currency] = roundMoney((totals[level][currency] || 0) + value);
  }
  return totals;
}

export function crmOpportunityTotalsFromAggregates(rows: readonly CrmOpportunityAggregate[]) {
  const totals: Record<CrmForecastLevel, CrmCurrencyTotals> = {
    pipeline: {},
    possible: {},
    commit: {},
    won: {},
    excluded: {}
  };
  for (const row of rows) {
    const value = Number(row.total);
    const currency = row.currency?.trim().toUpperCase();
    if (!Number.isFinite(value) || !currency) continue;
    const level = crmForecastForStage(row.stage);
    totals[level][currency] = roundMoney((totals[level][currency] || 0) + value);
  }
  return totals;
}

export function crmConversionRate(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function crmDaysBetween(start: Date | string, end: Date | string) {
  const left = new Date(start).getTime();
  const right = new Date(end).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return Math.max(0, Math.floor((right - left) / 86_400_000));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
