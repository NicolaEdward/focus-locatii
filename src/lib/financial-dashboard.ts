import { prisma } from "@/lib/prisma";
import { moneyNumber, type MoneyInput } from "@/lib/money";

export type FinancialDashboardData = Awaited<ReturnType<typeof getFinancialDashboardData>>;

export async function getFinancialDashboardData() {
  const now = startOfUtcDay(new Date());
  const inSevenDays = addDays(now, 7);
  const inThirtyDays = addDays(now, 30);

  const [latestUpload, activeUpload, recentUploads, smartBillUploads] = await Promise.all([
    prisma.financialReportUpload.findFirst({
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { uploadedAt: "desc" }
    }),
    prisma.financialReportUpload.findFirst({
      where: { activeVersion: true, status: "confirmed" },
      include: {
        uploadedBy: { select: { name: true, email: true } },
        companySnapshots: { orderBy: { companyName: "asc" } }
      },
      orderBy: { uploadedAt: "desc" }
    }),
    prisma.financialReportUpload.findMany({
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { uploadedAt: "desc" },
      take: 8
    }),
    prisma.financialReportUpload.findMany({
      where: { status: "confirmed", fileHash: { startsWith: "smartbill-" } },
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { uploadedAt: "desc" },
      take: 50
    })
  ]);

  const dashboardUpload = activeUpload || smartBillUploads[0] || null;
  if (!dashboardUpload) {
    return emptyFinancialDashboard(latestUpload, recentUploads);
  }
  const uploadIds = Array.from(new Set([
    activeUpload?.id,
    ...smartBillUploads.map((upload) => upload.id)
  ].filter((id): id is string => Boolean(id))));

  const [payables, receivables, issues] = await Promise.all([
    prisma.financialPayable.findMany({
      where: { uploadId: { in: uploadIds } },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }]
    }),
    prisma.financialReceivable.findMany({
      where: {
        OR: [
          { uploadId: { in: uploadIds } },
          { canonicalKey: { not: null } }
        ]
      },
      orderBy: [{ dueDate: "asc" }, { remainingAmount: "desc" }]
    }),
    prisma.financialImportIssue.findMany({
      where: { uploadId: { in: uploadIds }, severity: { not: "info" } },
      orderBy: [{ severity: "desc" }, { rowNumber: "asc" }],
      take: 80
    })
  ]);

  const clearPayables = payables.filter((row) => !row.needsReview && row.includedInReport && row.currency);
  const clearReceivables = receivables.filter((row) => !row.needsReview && row.includedInReport && row.currency);
  const payableOpen = clearPayables.filter((row) => moneyNumber(row.remainingAmount) > 0);
  const receivableOpen = clearReceivables.filter((row) => moneyNumber(row.remainingAmount) > 0);
  const overduePayables = payableOpen.filter((row) => row.dueDate && row.dueDate < now);
  const overdueReceivables = receivableOpen.filter((row) => row.dueDate && row.dueDate < now);
  const dueTodayPayables = payableOpen.filter((row) => row.dueDate && row.dueDate.getTime() === now.getTime());
  const dueTodayReceivables = receivableOpen.filter((row) => row.dueDate && row.dueDate.getTime() === now.getTime());
  const dueSoonPayables = payableOpen.filter((row) => row.dueDate && row.dueDate > now && row.dueDate <= inSevenDays);
  const dueSoonReceivables = receivableOpen.filter((row) => row.dueDate && row.dueDate > now && row.dueDate <= inSevenDays);
  const dueThirtyPayables = payableOpen.filter((row) => row.dueDate && row.dueDate > now && row.dueDate <= inThirtyDays);
  const dueThirtyReceivables = receivableOpen.filter((row) => row.dueDate && row.dueDate > now && row.dueDate <= inThirtyDays);
  const needsReviewPayables = payables.filter((row) => row.needsReview || !row.currency);
  const needsReviewReceivables = receivables.filter((row) => row.needsReview || !row.currency);

  return {
    hasActiveReport: true,
    todayReportLoaded: [activeUpload, ...smartBillUploads].filter(isDefined).some((upload) => sameReportDay(upload.reportDate, now)),
    latestUpload: serializeUpload(latestUpload),
    activeUpload: serializeUpload(dashboardUpload),
    uploads: recentUploads.map(serializeUpload).filter(isDefined),
    kpis: {
      totalReceivable: sum(clearReceivables, "invoicedAmount"),
      totalPayable: sum(clearPayables, "amountToPay"),
      netCashPosition: roundMoney(sum(clearReceivables, "remainingAmount") - sum(clearPayables, "remainingAmount")),
      dueToday: roundMoney(sum(dueTodayReceivables, "remainingAmount") + sum(dueTodayPayables, "remainingAmount")),
      overdue: roundMoney(sum(overdueReceivables, "remainingAmount") + sum(overduePayables, "remainingAmount")),
      dueNext7Days: roundMoney(sum(dueSoonReceivables, "remainingAmount") + sum(dueSoonPayables, "remainingAmount")),
      dueNext30Days: roundMoney(sum(dueThirtyReceivables, "remainingAmount") + sum(dueThirtyPayables, "remainingAmount")),
      totalCollected: sum(clearReceivables, "collectedAmount"),
      totalPaid: sum(clearPayables, "amountPaid"),
      remainingReceivable: sum(clearReceivables, "remainingAmount"),
      remainingPayable: sum(clearPayables, "remainingAmount"),
      totalReceivableRon: sumCurrency(clearReceivables, "invoicedAmount", "RON"),
      totalReceivableEur: sumCurrency(clearReceivables, "invoicedAmount", "EUR"),
      totalPayableRon: sumCurrency(clearPayables, "amountToPay", "RON"),
      totalPayableEur: sumCurrency(clearPayables, "amountToPay", "EUR"),
      totalCollectedRon: sumCurrency(clearReceivables, "collectedAmount", "RON"),
      totalCollectedEur: sumCurrency(clearReceivables, "collectedAmount", "EUR"),
      totalPaidRon: sumCurrency(clearPayables, "amountPaid", "RON"),
      totalPaidEur: sumCurrency(clearPayables, "amountPaid", "EUR"),
      remainingReceivableRon: sumCurrency(clearReceivables, "remainingAmount", "RON"),
      remainingReceivableEur: sumCurrency(clearReceivables, "remainingAmount", "EUR"),
      remainingPayableRon: sumCurrency(clearPayables, "remainingAmount", "RON"),
      remainingPayableEur: sumCurrency(clearPayables, "remainingAmount", "EUR"),
      overdueReceivableRon: sumCurrency(overdueReceivables, "remainingAmount", "RON"),
      overdueReceivableEur: sumCurrency(overdueReceivables, "remainingAmount", "EUR"),
      overduePayableRon: sumCurrency(overduePayables, "remainingAmount", "RON"),
      overduePayableEur: sumCurrency(overduePayables, "remainingAmount", "EUR"),
      dueTodayReceivableRon: sumCurrency(dueTodayReceivables, "remainingAmount", "RON"),
      dueTodayReceivableEur: sumCurrency(dueTodayReceivables, "remainingAmount", "EUR"),
      dueTodayPayableRon: sumCurrency(dueTodayPayables, "remainingAmount", "RON"),
      dueTodayPayableEur: sumCurrency(dueTodayPayables, "remainingAmount", "EUR"),
      dueNext7ReceivableRon: sumCurrency(dueSoonReceivables, "remainingAmount", "RON"),
      dueNext7ReceivableEur: sumCurrency(dueSoonReceivables, "remainingAmount", "EUR"),
      dueNext7PayableRon: sumCurrency(dueSoonPayables, "remainingAmount", "RON"),
      dueNext7PayableEur: sumCurrency(dueSoonPayables, "remainingAmount", "EUR"),
      overdueReceivableCount: overdueReceivables.length,
      overduePayableCount: overduePayables.length,
      needsReviewCount: needsReviewPayables.length + needsReviewReceivables.length
    },
    companies: buildCompanyRows(clearPayables, clearReceivables, issues),
    lists: {
      overdueReceivables: overdueReceivables.slice(0, 200).map(serializeReceivable),
      dueTodayReceivables: dueTodayReceivables.slice(0, 200).map(serializeReceivable),
      dueSoonReceivables: dueSoonReceivables.slice(0, 200).map(serializeReceivable),
      overduePayables: overduePayables.slice(0, 200).map(serializePayable),
      dueTodayPayables: dueTodayPayables.slice(0, 200).map(serializePayable),
      dueSoonPayables: dueSoonPayables.slice(0, 200).map(serializePayable),
      topReceivables: receivableOpen.sort((a, b) => moneyNumber(b.remainingAmount) - moneyNumber(a.remainingAmount)).slice(0, 200).map(serializeReceivable),
      topPayables: payableOpen.sort((a, b) => moneyNumber(b.remainingAmount) - moneyNumber(a.remainingAmount)).slice(0, 200).map(serializePayable),
      missingDueReceivables: receivableOpen.filter((row) => !row.dueDate).slice(0, 200).map(serializeReceivable),
      missingDuePayables: payableOpen.filter((row) => !row.dueDate).slice(0, 200).map(serializePayable),
      needsReviewReceivables: needsReviewReceivables.slice(0, 200).map(serializeReceivable),
      needsReviewPayables: needsReviewPayables.slice(0, 200).map(serializePayable)
    },
    issues: issues.map((row) => ({
      id: row.id,
      companyName: row.companyName,
      sheetName: row.sheetName,
      rowNumber: row.rowNumber,
      issueType: row.issueType,
      issueMessage: row.issueMessage,
      severity: row.severity
    }))
  };
}

type CompanyPayableRow = {
  companyName: string;
  companyCode: string | null;
  amountToPay: MoneyInput;
  amountPaid: MoneyInput;
  remainingAmount: MoneyInput;
  currency: string | null;
  needsReview: boolean;
  includedInReport: boolean;
};

type CompanyReceivableRow = {
  companyName: string;
  companyCode: string | null;
  invoicedAmount: MoneyInput;
  collectedAmount: MoneyInput;
  remainingAmount: MoneyInput;
  currency: string | null;
  needsReview: boolean;
  includedInReport: boolean;
};

type CompanyIssueRow = {
  companyName: string | null;
};

function buildCompanyRows(payables: CompanyPayableRow[], receivables: CompanyReceivableRow[], issues: CompanyIssueRow[]) {
  const companyKeys = Array.from(new Set([...payables, ...receivables].map((row) => row.companyCode || row.companyName)));
  return companyKeys.sort().map((companyKey) => {
    const companyPayables = payables.filter((row) => (row.companyCode || row.companyName) === companyKey);
    const companyReceivables = receivables.filter((row) => (row.companyCode || row.companyName) === companyKey);
    const companyName = companyReceivables[0]?.companyName || companyPayables[0]?.companyName || companyKey;
    const companyCode = companyReceivables[0]?.companyCode || companyPayables[0]?.companyCode || null;
    return {
      id: companyCode || companyName,
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
      issueCount: issues.filter((issue) => issue.companyName === companyName).length
    };
  });
}

function emptyFinancialDashboard(latestUpload: Awaited<ReturnType<typeof prisma.financialReportUpload.findFirst>>, uploads: Awaited<ReturnType<typeof prisma.financialReportUpload.findMany>>) {
  return {
    hasActiveReport: false,
    todayReportLoaded: false,
    latestUpload: serializeUpload(latestUpload),
    activeUpload: null,
    uploads: uploads.map(serializeUpload).filter(isDefined),
    kpis: {
      totalReceivable: 0,
      totalPayable: 0,
      netCashPosition: 0,
      dueToday: 0,
      overdue: 0,
      dueNext7Days: 0,
      dueNext30Days: 0,
      totalCollected: 0,
      totalPaid: 0,
      remainingReceivable: 0,
      remainingPayable: 0,
      totalReceivableRon: 0,
      totalReceivableEur: 0,
      totalPayableRon: 0,
      totalPayableEur: 0,
      totalCollectedRon: 0,
      totalCollectedEur: 0,
      totalPaidRon: 0,
      totalPaidEur: 0,
      remainingReceivableRon: 0,
      remainingReceivableEur: 0,
      remainingPayableRon: 0,
      remainingPayableEur: 0,
      overdueReceivableRon: 0,
      overdueReceivableEur: 0,
      overduePayableRon: 0,
      overduePayableEur: 0,
      dueTodayReceivableRon: 0,
      dueTodayReceivableEur: 0,
      dueTodayPayableRon: 0,
      dueTodayPayableEur: 0,
      dueNext7ReceivableRon: 0,
      dueNext7ReceivableEur: 0,
      dueNext7PayableRon: 0,
      dueNext7PayableEur: 0,
      overdueReceivableCount: 0,
      overduePayableCount: 0,
      needsReviewCount: 0
    },
    companies: [],
    lists: {
      overdueReceivables: [],
      dueTodayReceivables: [],
      dueSoonReceivables: [],
      overduePayables: [],
      dueTodayPayables: [],
      dueSoonPayables: [],
      topReceivables: [],
      topPayables: [],
      missingDueReceivables: [],
      missingDuePayables: [],
      needsReviewReceivables: [],
      needsReviewPayables: []
    },
    issues: []
  };
}

function serializeUpload(upload: {
  id: string;
  reportDate: Date | null;
  uploadedAt: Date;
  originalFileName: string;
  status: string;
  activeVersion: boolean;
  uploadedBy?: { name: string; email: string } | null;
} | null) {
  return upload ? {
    id: upload.id,
    reportDate: upload.reportDate?.toISOString() || null,
    uploadedAt: upload.uploadedAt.toISOString(),
    originalFileName: upload.originalFileName,
    status: upload.status,
    activeVersion: upload.activeVersion,
    uploadedBy: upload.uploadedBy?.name || upload.uploadedBy?.email || null
  } : null;
}

function isDefined<T>(value: T | null): value is T {
  return value != null;
}

function serializePayable(row: {
  id: string;
  companyName: string;
  supplierName: string | null;
  documentDescription: string | null;
  dueDate: Date | null;
  amountToPay: MoneyInput;
  amountPaid: MoneyInput;
  remainingAmount: MoneyInput;
  currency: string | null;
  status: string;
  needsReview: boolean;
  includedInReport?: boolean;
  rawRowJson?: unknown;
  reviewNote: string | null;
}) {
  return {
    id: row.id,
    kind: "payable" as const,
    companyName: row.companyName,
    name: row.supplierName || "Furnizor neclar",
    description: row.documentDescription,
    documentDescription: row.documentDescription,
    dueDate: row.dueDate?.toISOString() || null,
    amount: moneyNumber(row.amountToPay),
    paidOrCollected: moneyNumber(row.amountPaid),
    remaining: moneyNumber(row.remainingAmount),
    currency: row.currency || null,
    status: row.status,
    needsReview: row.needsReview,
    includedInReport: row.includedInReport ?? true,
    rawRowJson: row.rawRowJson,
    reviewNote: row.reviewNote
  };
}

function serializeReceivable(row: {
  id: string;
  companyName: string;
  invoiceNumber: string | null;
  location: string | null;
  campaignDetails: string | null;
  clientName: string | null;
  dueDate: Date | null;
  invoicedAmount: MoneyInput;
  collectedAmount: MoneyInput;
  remainingAmount: MoneyInput;
  currency: string | null;
  status: string;
  needsReview: boolean;
  includedInReport?: boolean;
  rawRowJson?: unknown;
  reviewNote: string | null;
}) {
  return {
    id: row.id,
    kind: "receivable" as const,
    companyName: row.companyName,
    name: row.clientName || "Client neclar",
    description: [row.invoiceNumber, row.location, row.campaignDetails].filter(Boolean).join(" / ") || null,
    invoiceNumber: row.invoiceNumber,
    location: row.location,
    campaignDetails: row.campaignDetails,
    dueDate: row.dueDate?.toISOString() || null,
    amount: moneyNumber(row.invoicedAmount),
    paidOrCollected: moneyNumber(row.collectedAmount),
    remaining: moneyNumber(row.remainingAmount),
    currency: row.currency || null,
    status: row.status,
    needsReview: row.needsReview,
    includedInReport: row.includedInReport ?? true,
    rawRowJson: row.rawRowJson,
    reviewNote: row.reviewNote
  };
}

function sameReportDay(value: Date | null, today: Date) {
  return Boolean(value && startOfUtcDay(value).getTime() === today.getTime());
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sum<T>(rows: T[], key: keyof T) {
  return roundMoney(rows.reduce((total, row) => total + moneyNumber(row[key] as MoneyInput), 0));
}

function sumCurrency<T extends { currency: string | null }>(rows: T[], key: keyof T, currency: "RON" | "EUR") {
  return sum(rows.filter((row) => row.currency === currency), key);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
