import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { money, receivableStatus } from "@/lib/receivables-domain";
import { deriveCampaignEffectiveStatus } from "@/lib/campaigns/campaign-effective-status";
import { receivableOwnershipWhere } from "@/lib/receivables-ownership";

const SETTLED_TOLERANCE = new Prisma.Decimal("0.01");

export type ReceivableRegistryView = "open" | "history";

export type ReceivableRegistryInput = {
  query?: string;
  status?: string;
  companyCode?: string;
  currency?: string;
  ownerUserId?: string;
  view?: ReceivableRegistryView;
  page?: number;
  take?: number;
  asOf?: string;
  validatedOnly?: boolean;
};

export async function listReceivableRegistry(input: ReceivableRegistryInput = {}) {
  const query = input.query?.trim() || "";
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 40);
  const view: ReceivableRegistryView = input.view === "history" ? "history" : "open";
  const today = registryAsOf(input.asOf);
  const baseWhere = receivableBaseWhere({
    query,
    companyCode: input.companyCode,
    currency: input.currency,
    ownerUserId: input.ownerUserId,
    validatedOnly: input.validatedOnly
  });
  const viewWhere: Prisma.FinancialReceivableWhereInput = view === "history"
    ? {
        AND: [
          baseWhere,
          { remainingAmount: { lte: SETTLED_TOLERANCE } },
          { collectedAmount: { gt: 0 } }
        ]
      }
    : {
        AND: [
          baseWhere,
          { remainingAmount: { gt: SETTLED_TOLERANCE } },
          receivableStatusWhere(input.status || "", today)
        ]
      };

  const [items, total, summary, issuerCompanies] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: viewWhere,
      select: {
        id: true,
        clientId: true,
        companyName: true,
        companyCode: true,
        invoiceNumber: true,
        invoiceDate: true,
        clientName: true,
        dueDate: true,
        invoicedAmount: true,
        collectedAmount: true,
        remainingAmount: true,
        collectedAt: true,
        currency: true,
        status: true,
        needsReview: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } }
      },
      orderBy: view === "history"
        ? [{ collectedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }]
        : [{ dueDate: "asc" }, { remainingAmount: "desc" }, { id: "asc" }],
      skip: (page - 1) * take,
      take
    }),
    prisma.financialReceivable.count({ where: viewWhere }),
    view === "open" ? receivableOpenSummary(baseWhere, today) : Promise.resolve([]),
    view === "open" ? listIssuerCompanies() : Promise.resolve([])
  ]);

  return {
    view,
    items: items.map((row) => ({
      ...row,
      invoiceDate: iso(row.invoiceDate),
      dueDate: iso(row.dueDate),
      collectedAt: iso(row.collectedAt),
      updatedAt: row.updatedAt.toISOString(),
      invoicedAmount: decimalString(row.invoicedAmount),
      collectedAmount: decimalString(row.collectedAmount),
      remainingAmount: decimalString(row.remainingAmount),
      status: receivableStatus({
        invoiceAmount: row.invoicedAmount,
        collectedAmount: row.collectedAmount,
        dueDate: row.dueDate,
        now: today
      })
    })),
    summary,
    issuerCompanies,
    pagination: pagination(page, take, total)
  };
}

function registryAsOf(value?: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  return startOfUtcDay(new Date());
}

export async function listReceivableImports(input: { page?: number; take?: number } = {}) {
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 25);
  const where: Prisma.FinancialReportUploadWhereInput = {
    OR: [{ receivableImportRows: { some: {} } }, { receivables: { some: {} } }]
  };
  const [items, total] = await Promise.all([
    prisma.financialReportUpload.findMany({
      where,
      select: {
        id: true,
        originalFileName: true,
        reportDate: true,
        uploadedAt: true,
        status: true,
        errorSummary: true,
        uploadedBy: { select: { name: true } },
        _count: { select: { receivableImportRows: true, receivables: true, issues: true } }
      },
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * take,
      take
    }),
    prisma.financialReportUpload.count({ where })
  ]);
  return {
    items: items.map((row) => ({ ...row, reportDate: iso(row.reportDate), uploadedAt: row.uploadedAt.toISOString() })),
    pagination: pagination(page, take, total)
  };
}

export async function listReceivablePayments(input: { query?: string; page?: number; take?: number } = {}) {
  const query = input.query?.trim() || "";
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 40);
  const where: Prisma.FinancialReceivablePaymentWhereInput = query ? {
    receivable: {
      is: {
        OR: [
          { invoiceNumber: { contains: query } },
          { clientName: { contains: query } },
          { client: { is: { companyName: { contains: query } } } }
        ]
      }
    }
  } : {};
  const [items, total] = await Promise.all([
    prisma.financialReceivablePayment.findMany({
      where,
      select: {
        id: true,
        receivableId: true,
        amount: true,
        currency: true,
        receivedAt: true,
        paymentMethod: true,
        paymentReference: true,
        notes: true,
        source: true,
        status: true,
        correctsPaymentId: true,
        cancelledAt: true,
        cancellationReason: true,
        createdAt: true,
        receivable: { select: { invoiceNumber: true, clientName: true, client: { select: { companyName: true } } } },
        createdBy: { select: { name: true } },
        cancelledBy: { select: { name: true } }
      },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * take,
      take
    }),
    prisma.financialReceivablePayment.count({ where })
  ]);
  return {
    items: items.map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      receivedAt: row.receivedAt.toISOString(),
      cancelledAt: iso(row.cancelledAt),
      createdAt: row.createdAt.toISOString(),
      receivable: {
        invoiceNumber: row.receivable.invoiceNumber,
        clientName: row.receivable.client?.companyName || row.receivable.clientName
      }
    })),
    pagination: pagination(page, take, total)
  };
}

export async function listReceivableAliases(input: { query?: string; page?: number; take?: number } = {}) {
  const query = input.query?.trim() || "";
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 40);
  const where: Prisma.FinancialClientAliasWhereInput = query ? {
    OR: [
      { aliasName: { contains: query } },
      { client: { is: { companyName: { contains: query } } } }
    ]
  } : {};
  const [items, total] = await Promise.all([
    prisma.financialClientAlias.findMany({
      where,
      select: {
        id: true,
        companyCode: true,
        aliasName: true,
        normalizedAlias: true,
        clientId: true,
        createdAt: true,
        client: { select: { companyName: true } },
        createdBy: { select: { name: true } }
      },
      orderBy: [{ companyCode: "asc" }, { aliasName: "asc" }],
      skip: (page - 1) * take,
      take
    }),
    prisma.financialClientAlias.count({ where })
  ]);
  return {
    items: items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    pagination: pagination(page, take, total)
  };
}

export async function listReceivableCredits(input: { page?: number; take?: number } = {}) {
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 40);
  const where: Prisma.FinancialClientCreditWhereInput = { status: "available" };
  const [items, total, totals] = await Promise.all([
    prisma.financialClientCredit.findMany({
      where,
      select: {
        id: true,
        clientId: true,
        receivableId: true,
        companyName: true,
        companyCode: true,
        currency: true,
        amount: true,
        remainingAmount: true,
        status: true,
        reason: true,
        createdAt: true,
        client: { select: { companyName: true } }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take
    }),
    prisma.financialClientCredit.count({ where }),
    prisma.financialClientCredit.groupBy({
      by: ["currency"],
      where,
      _count: { _all: true },
      _sum: { remainingAmount: true }
    })
  ]);
  return {
    items: items.map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      remainingAmount: row.remainingAmount.toFixed(2),
      createdAt: row.createdAt.toISOString()
    })),
    totals: totals.map((row) => ({
      currency: row.currency,
      count: row._count._all,
      remainingAmount: decimalString(row._sum.remainingAmount)
    })),
    pagination: pagination(page, take, total)
  };
}

export type ReconciliationCategory =
  | "expected_by_active_ledger"
  | "archived_legacy_snapshot"
  | "import_anomaly"
  | "manual_correction"
  | "unresolved";

export async function listReceivableReconciliation(input: { category?: string; page?: number; take?: number } = {}) {
  const page = normalizedPage(input.page);
  const take = normalizedTake(input.take, 40);
  const [receivables, ledgerRows, paymentSources] = await Promise.all([
    prisma.financialReceivable.findMany({
      select: {
        id: true,
        companyCode: true,
        companyName: true,
        invoiceNumber: true,
        clientName: true,
        currency: true,
        collectedAmount: true,
        remainingAmount: true,
        includedInReport: true,
        status: true,
        lastReportDate: true,
        lastImportedAt: true,
        _count: { select: { importRows: true } },
        client: { select: { companyName: true } }
      },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.financialReceivablePayment.groupBy({
      by: ["receivableId"],
      where: { status: "active" },
      _count: { _all: true },
      _sum: { amount: true }
    }),
    prisma.financialReceivablePayment.findMany({
      where: { status: "active" },
      select: { receivableId: true, source: true }
    })
  ]);
  const ledgerByReceivable = new Map(ledgerRows.map((row) => [row.receivableId, row]));
  const sourcesByReceivable = new Map<string, Set<string>>();
  for (const row of paymentSources) {
    const sources = sourcesByReceivable.get(row.receivableId) || new Set<string>();
    sources.add(row.source);
    sourcesByReceivable.set(row.receivableId, sources);
  }

  const classified = receivables.map((row) => {
    const ledger = ledgerByReceivable.get(row.id);
    const snapshotCollected = money(row.collectedAmount);
    const ledgerCollected = money(ledger?._sum.amount);
    const difference = snapshotCollected.minus(ledgerCollected);
    const sources = [...(sourcesByReceivable.get(row.id) || new Set<string>())];
    const category = classifyReceivableReconciliation({
      difference,
      includedInReport: row.includedInReport,
      status: row.status,
      paymentCount: ledger?._count._all || 0,
      importRowCount: row._count.importRows,
      lastImportedAt: row.lastImportedAt,
      sources
    });
    return {
      id: row.id,
      companyCode: row.companyCode,
      companyName: row.companyName,
      invoiceNumber: row.invoiceNumber,
      clientName: row.client?.companyName || row.clientName || "Client nealocat",
      currency: row.currency,
      snapshotCollected: snapshotCollected.toFixed(2),
      activeLedgerCollected: ledgerCollected.toFixed(2),
      difference: difference.toFixed(2),
      remainingAmount: decimalString(row.remainingAmount),
      includedInReport: row.includedInReport,
      status: row.status,
      activePaymentCount: ledger?._count._all || 0,
      importRowCount: row._count.importRows,
      paymentSources: sources,
      lastReportDate: iso(row.lastReportDate),
      category,
      evidence: reconciliationEvidence(category, row._count.importRows, sources)
    };
  });
  const counts = reconciliationCounts(classified.map((row) => row.category));
  const mismatches = classified.filter((row) => row.category !== "expected_by_active_ledger");
  const filtered = input.category && input.category !== "all"
    ? mismatches.filter((row) => row.category === input.category)
    : mismatches;
  const start = (page - 1) * take;
  return {
    generatedAt: new Date().toISOString(),
    tolerance: "0.01",
    readOnly: true,
    counts: {
      totalReceivables: classified.length,
      mismatches: mismatches.length,
      ...counts
    },
    items: filtered.slice(start, start + take),
    pagination: pagination(page, take, filtered.length)
  };
}

export async function searchReceivableOptions(input: {
  type: "clients" | "campaigns" | "locations" | "receivables";
  query?: string;
  clientId?: string;
  selectedId?: string;
  take?: number;
}) {
  const query = input.query?.trim() || "";
  const take = normalizedTake(input.take, 20, 5, 50);
  if (input.type === "clients") {
    const where: Prisma.ClientAccountWhereInput = {
      status: { notIn: ["merged", "archived"] },
      ...(query ? { OR: [{ companyName: { contains: query } }, { taxId: { contains: query } }] } : {})
    };
    const [matches, selected] = await Promise.all([
      prisma.clientAccount.findMany({
        where,
        select: { id: true, companyName: true, taxId: true },
        orderBy: { companyName: "asc" },
        take
      }),
      input.selectedId
        ? prisma.clientAccount.findFirst({
            where: { id: input.selectedId, status: { notIn: ["merged", "archived"] } },
            select: { id: true, companyName: true, taxId: true }
          })
        : Promise.resolve(null)
    ]);
    const items = selected && !matches.some((item) => item.id === selected.id)
      ? [selected, ...matches].slice(0, take)
      : matches;
    return items.map((row) => ({ id: row.id, label: row.companyName, detail: row.taxId }));
  }
  if (input.type === "campaigns") {
    const items = await prisma.campaign.findMany({
      where: {
        archivedAt: null,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(query ? { campaignName: { contains: query } } : {})
      },
      select: { id: true, campaignName: true, status: true, startDate: true, endDate: true },
      orderBy: { startDate: "desc" },
      take
    });
    return items.map((row) => ({
      id: row.id,
      label: row.campaignName,
      detail: `${deriveCampaignEffectiveStatus(row).label} / ${iso(row.startDate) || "fara data"}`
    }));
  }
  if (input.type === "locations") {
    const items = await prisma.location.findMany({
      where: query ? { OR: [{ code: { contains: query } }, { address: { contains: query } }, { city: { contains: query } }] } : {},
      select: { id: true, code: true, address: true, city: true },
      orderBy: { code: "asc" },
      take
    });
    return items.map((row) => ({ id: row.id, label: row.code, detail: row.address || row.city }));
  }
  const items = await prisma.financialReceivable.findMany({
    where: {
      includedInReport: true,
      ...(query ? { OR: [{ invoiceNumber: { contains: query } }, { clientName: { contains: query } }] } : {})
    },
    select: { id: true, invoiceNumber: true, clientName: true, currency: true, invoicedAmount: true },
    orderBy: { updatedAt: "desc" },
    take
  });
  return items.map((row) => ({
    id: row.id,
    label: row.invoiceNumber || "Fara numar",
    detail: `${row.clientName || "Client nealocat"} · ${decimalString(row.invoicedAmount)} ${row.currency || ""}`.trim()
  }));
}

async function receivableOpenSummary(baseWhere: Prisma.FinancialReceivableWhereInput, today: Date) {
  const inSevenDays = addDays(today, 7);
  const openWhere: Prisma.FinancialReceivableWhereInput = { AND: [baseWhere, { remainingAmount: { gt: SETTLED_TOLERANCE } }] };
  const groups = await prisma.financialReceivable.groupBy({
    by: ["currency", "dueDate", "needsReview"],
    where: openWhere,
    _count: { _all: true },
    _sum: { remainingAmount: true }
  });
  const summary = new Map<string, {
    currency: string;
    openCount: number;
    overdueCount: number;
    inTermCount: number;
    dueSoonCount: number;
    needsReviewCount: number;
    remaining: Prisma.Decimal;
    overdue: Prisma.Decimal;
    inTerm: Prisma.Decimal;
    dueSoon: Prisma.Decimal;
  }>();
  for (const group of groups) {
    const currency = group.currency || "NECUNOSCUTA";
    const current = summary.get(currency) || {
      currency,
      openCount: 0,
      overdueCount: 0,
      inTermCount: 0,
      dueSoonCount: 0,
      needsReviewCount: 0,
      remaining: money(0),
      overdue: money(0),
      inTerm: money(0),
      dueSoon: money(0)
    };
    const count = group._count._all;
    const remaining = money(group._sum.remainingAmount);
    const dueAt = group.dueDate?.getTime();
    const isOverdue = dueAt !== undefined && dueAt < today.getTime();
    const isInTerm = dueAt !== undefined && dueAt >= today.getTime();
    const isDueSoon = isInTerm && dueAt <= inSevenDays.getTime();
    current.openCount += count;
    current.remaining = current.remaining.plus(remaining);
    if (group.needsReview) current.needsReviewCount += count;
    if (isOverdue) {
      current.overdueCount += count;
      current.overdue = current.overdue.plus(remaining);
    }
    if (isInTerm) {
      current.inTermCount += count;
      current.inTerm = current.inTerm.plus(remaining);
    }
    if (isDueSoon) {
      current.dueSoonCount += count;
      current.dueSoon = current.dueSoon.plus(remaining);
    }
    summary.set(currency, current);
  }
  return [...summary.values()].sort((left, right) => left.currency.localeCompare(right.currency)).map((row) => ({
    ...row,
    remaining: row.remaining.toFixed(2),
    overdue: row.overdue.toFixed(2),
    inTerm: row.inTerm.toFixed(2),
    dueSoon: row.dueSoon.toFixed(2)
  }));
}

export function classifyReceivableReconciliation(input: {
  difference: Prisma.Decimal;
  includedInReport: boolean;
  status: string;
  paymentCount: number;
  importRowCount: number;
  lastImportedAt: Date | null;
  sources: string[];
}): ReconciliationCategory {
  if (input.difference.abs().lessThanOrEqualTo(SETTLED_TOLERANCE)) return "expected_by_active_ledger";
  if (input.sources.some((source) => source === "manual" || source === "manual_correction")) return "manual_correction";
  if ((!input.includedInReport || ["archived", "excluded", "cancelled"].includes(input.status)) && input.paymentCount === 0) {
    return "archived_legacy_snapshot";
  }
  if (input.importRowCount > 0 || input.lastImportedAt) return "import_anomaly";
  return "unresolved";
}

function reconciliationEvidence(category: ReconciliationCategory, importRowCount: number, sources: string[]) {
  if (category === "expected_by_active_ledger") return "Snapshotul corespunde sumei platilor active.";
  if (category === "archived_legacy_snapshot") return "Rand istoric exclus/arhivat, cu suma colectata in snapshot si fara plata in ledger.";
  if (category === "import_anomaly") return `Exista dovada de import (${importRowCount} randuri), dar snapshotul nu corespunde ledgerului activ.`;
  if (category === "manual_correction") return `Exista plati manuale (${sources.join(", ")}), iar diferenta necesita verificare individuala.`;
  return "Nu exista suficienta dovada determinista pentru clasificare automata.";
}

function reconciliationCounts(categories: ReconciliationCategory[]) {
  const counts: Record<ReconciliationCategory, number> = {
    expected_by_active_ledger: 0,
    archived_legacy_snapshot: 0,
    import_anomaly: 0,
    manual_correction: 0,
    unresolved: 0
  };
  for (const category of categories) counts[category] += 1;
  return counts;
}

function receivableBaseWhere(input: { query: string; companyCode?: string; currency?: string; ownerUserId?: string; validatedOnly?: boolean }): Prisma.FinancialReceivableWhereInput {
  return {
    includedInReport: true,
    ...(input.validatedOnly ? { needsReview: false } : {}),
    ...(input.companyCode ? { companyCode: input.companyCode } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.ownerUserId ? receivableOwnershipWhere(input.ownerUserId) : {}),
    ...(input.query ? {
      OR: [
        { invoiceNumber: { contains: input.query } },
        { clientName: { contains: input.query } },
        { location: { contains: input.query } },
        { campaignDetails: { contains: input.query } },
        { client: { is: { companyName: { contains: input.query } } } }
      ]
    } : {})
  };
}

function receivableStatusWhere(status: string, today: Date): Prisma.FinancialReceivableWhereInput {
  if (!status || status === "open") return {};
  if (status === "overdue") return { dueDate: { lt: today } };
  if (status === "in_term") return { dueDate: { gte: today } };
  if (status === "due_soon") return { dueDate: { gte: today, lte: addDays(today, 7) } };
  if (status === "missing_due") return { dueDate: null };
  if (status === "collected_partial") return { collectedAmount: { gt: 0 } };
  if (status === "client_credit") return { status: "client_credit" };
  return {};
}

async function listIssuerCompanies() {
  return prisma.financialReceivable.findMany({
    where: { includedInReport: true },
    select: { companyCode: true, companyName: true },
    distinct: ["companyCode", "companyName"],
    orderBy: { companyName: "asc" }
  });
}

function pagination(page: number, take: number, total: number) {
  return { page, take, total, totalPages: Math.max(1, Math.ceil(total / take)) };
}

function normalizedPage(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value as number)) : 1;
}

function normalizedTake(value: number | undefined, fallback: number, minimum = 10, maximum = 100) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value as number), minimum), maximum) : fallback;
}

function decimalString(value: Prisma.Decimal | null | undefined) {
  return money(value).toFixed(2);
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() || null;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
