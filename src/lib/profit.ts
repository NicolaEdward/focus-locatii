import { calculateProrata } from "@/lib/prorata";

export type ProfitInput = {
  monthlyRevenue: number | null | undefined;
  revenueCurrency?: string | null;
  monthlyCost?: number | null;
  costCurrency?: string | null;
  periodStart: Date;
  periodEnd: Date;
  reportStart: Date;
  reportEnd: Date;
};

export function calculateLocationProfit(input: ProfitInput) {
  const revenueCurrency = ["RON", "EUR"].includes(input.revenueCurrency || "") ? input.revenueCurrency! : null;
  const revenue = calculateProrata(input.monthlyRevenue || 0, input.periodStart, input.periodEnd, input.reportStart, input.reportEnd).amount;
  const costStatus =
    !revenueCurrency
      ? "unknown_revenue_currency"
      : input.monthlyCost == null
      ? "missing_cost"
      : !["RON", "EUR"].includes(input.costCurrency || "")
        ? "unknown_cost_currency"
        : input.costCurrency !== revenueCurrency
        ? "needs_fx"
        : "ok";
  const cost = costStatus === "ok"
    ? calculateProrata(input.monthlyCost || 0, input.periodStart, input.periodEnd, input.reportStart, input.reportEnd).amount
    : null;
  const grossProfit = cost == null ? null : roundMoney(revenue - cost);
  const grossMargin = grossProfit == null || revenue <= 0 ? null : roundMoney((grossProfit / revenue) * 100);

  return {
    revenue,
    revenueCurrency,
    cost,
    costCurrency: input.costCurrency || null,
    grossProfit,
    grossMargin,
    costStatus
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
