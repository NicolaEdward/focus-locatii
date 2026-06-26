import { prisma } from "@/lib/prisma";
import { moneyNumber, type MoneyInput } from "@/lib/money";

type Currency = "RON" | "EUR";
type FinancialRow = {
  companyName: string;
  companyCode: string | null;
  currency: string | null;
  needsReview: boolean;
  includedInReport: boolean;
};

export function isCurrency(value: unknown): value is Currency {
  return value === "RON" || value === "EUR";
}

export function financialStatus(input: {
  kind: "payable" | "receivable";
  remainingAmount?: MoneyInput;
  paidOrCollected?: MoneyInput;
  dueDate?: Date | null;
  now?: Date;
  soonDays?: number;
}) {
  const remaining = moneyNumber(input.remainingAmount);
  const paid = moneyNumber(input.paidOrCollected);
  const dueDate = input.dueDate ? startOfUtcDay(input.dueDate) : null;
  const now = startOfUtcDay(input.now || new Date());
  const soonDays = input.soonDays ?? 7;

  if (remaining <= 0) return input.kind === "payable" ? "paid" : "collected";
  if (!dueDate) return "needs_review";
  if (dueDate < now) return "overdue";
  if (dueDate.getTime() === now.getTime()) return "due_today";
  if (daysBetween(now, dueDate) <= soonDays) return "due_soon";
  if (paid > 0) return input.kind === "payable" ? "paid_partial" : "collected_partial";
  return "in_term";
}

export async function recalculateFinancialSnapshots(uploadId: string) {
  const [payables, receivables] = await Promise.all([
    prisma.financialPayable.findMany({
      where: { uploadId, needsReview: false, includedInReport: true, currency: { in: ["RON", "EUR"] } }
    }),
    prisma.financialReceivable.findMany({
      where: { uploadId, needsReview: false, includedInReport: true, currency: { in: ["RON", "EUR"] } }
    })
  ]);

  const companyCodes = [...new Set([...payables, ...receivables].map((row) => row.companyCode || row.companyName))];
  const snapshots = companyCodes.map((companyCode) => {
    const companyName = [...payables, ...receivables].find((row) => (row.companyCode || row.companyName) === companyCode)?.companyName || companyCode;
    const companyPayables = payables.filter((row) => (row.companyCode || row.companyName) === companyCode);
    const companyReceivables = receivables.filter((row) => (row.companyCode || row.companyName) === companyCode);
    return {
      uploadId,
      companyName,
      companyCode,
      totalPayable: sum(companyPayables, "amountToPay"),
      totalPaid: sum(companyPayables, "amountPaid"),
      remainingPayable: sum(companyPayables, "remainingAmount"),
      totalReceivable: sum(companyReceivables, "invoicedAmount"),
      totalCollected: sum(companyReceivables, "collectedAmount"),
      remainingReceivable: sum(companyReceivables, "remainingAmount"),
      totalPayableRon: sumCurrency(companyPayables, "amountToPay", "RON"),
      totalPayableEur: sumCurrency(companyPayables, "amountToPay", "EUR"),
      totalPaidRon: sumCurrency(companyPayables, "amountPaid", "RON"),
      totalPaidEur: sumCurrency(companyPayables, "amountPaid", "EUR"),
      remainingPayableRon: sumCurrency(companyPayables, "remainingAmount", "RON"),
      remainingPayableEur: sumCurrency(companyPayables, "remainingAmount", "EUR"),
      totalReceivableRon: sumCurrency(companyReceivables, "invoicedAmount", "RON"),
      totalReceivableEur: sumCurrency(companyReceivables, "invoicedAmount", "EUR"),
      totalCollectedRon: sumCurrency(companyReceivables, "collectedAmount", "RON"),
      totalCollectedEur: sumCurrency(companyReceivables, "collectedAmount", "EUR"),
      remainingReceivableRon: sumCurrency(companyReceivables, "remainingAmount", "RON"),
      remainingReceivableEur: sumCurrency(companyReceivables, "remainingAmount", "EUR"),
      payableRows: companyPayables.length,
      receivableRows: companyReceivables.length,
      issueCount: 0
    };
  });

  await prisma.$transaction([
    prisma.financialReportCompanySnapshot.deleteMany({ where: { uploadId } }),
    ...(snapshots.length ? [prisma.financialReportCompanySnapshot.createMany({ data: snapshots })] : [])
  ]);
}

function sum<T>(rows: T[], key: keyof T) {
  return roundMoney(rows.reduce((total, row) => total + moneyNumber(row[key] as MoneyInput), 0));
}

function sumCurrency<T extends FinancialRow>(rows: T[], key: keyof T, currency: Currency) {
  return sum(rows.filter((row) => row.currency === currency && !row.needsReview && row.includedInReport), key);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(left: Date, right: Date) {
  return Math.ceil((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
