import { Prisma } from "@prisma/client";
import { normalizeClientName, normalizeInvoiceNumber } from "@/lib/clients";
import { normalizeFiscalCode } from "@/lib/smartbill-import";
import { money } from "@/lib/receivables-domain";
import { prisma } from "@/lib/prisma";

const EXCLUDED_CLASSIFICATIONS = ["internal_transfer", "intercompany_transfer", "bank_fee", "tax_payment"];
const ACTIVE = "active";

export type ReconciliationDirection = "receivable" | "payable";

export type ReconciliationScoreInput = {
  transaction: {
    amount: Prisma.Decimal.Value;
    bookedAt: Date;
    paymentDetails?: string | null;
    description?: string | null;
    payerTaxId?: string | null;
    beneficiaryTaxId?: string | null;
    payerName?: string | null;
    beneficiaryName?: string | null;
    merchantName?: string | null;
  };
  candidate: {
    amountRemaining: Prisma.Decimal.Value;
    invoiceNumber?: string | null;
    issueDate?: Date | null;
    dueDate?: Date | null;
    taxId?: string | null;
    partnerName?: string | null;
    aliases?: string[];
  };
  direction: ReconciliationDirection;
};

export function scoreReconciliationCandidate(input: ReconciliationScoreInput) {
  const reasons: string[] = [];
  let score = 0;
  const sourceText = normalizeSearchText([input.transaction.paymentDetails, input.transaction.description].filter(Boolean).join(" "));
  const invoice = normalizeInvoiceNumber(input.candidate.invoiceNumber);
  if (invoice && normalizeInvoiceNumber(sourceText).includes(invoice)) {
    score += 60;
    reasons.push("invoice_number_exact");
  }
  const transactionTaxId = normalizeFiscalCode(input.direction === "receivable" ? input.transaction.payerTaxId : input.transaction.beneficiaryTaxId);
  const candidateTaxId = normalizeFiscalCode(input.candidate.taxId);
  if (transactionTaxId && candidateTaxId && transactionTaxId === candidateTaxId) {
    score += 50;
    reasons.push("tax_id_exact");
  }
  if (money(input.transaction.amount).minus(money(input.candidate.amountRemaining)).abs().lessThanOrEqualTo("0.01")) {
    score += 30;
    reasons.push("amount_exact");
  }
  const sourceNames = [
    input.direction === "receivable" ? input.transaction.payerName : input.transaction.beneficiaryName,
    input.transaction.merchantName
  ].filter(Boolean).map(normalizeSearchText);
  const candidateNames = [input.candidate.partnerName, ...(input.candidate.aliases || [])].filter(Boolean).map(normalizeSearchText);
  if (sourceNames.some((source) => candidateNames.some((candidate) => source && candidate && (source === candidate || source.includes(candidate) || candidate.includes(source))))) {
    score += 25;
    reasons.push(input.transaction.merchantName ? "merchant_alias_match" : "partner_name_match");
  }
  const referenceDate = input.candidate.dueDate || input.candidate.issueDate;
  if (referenceDate && Math.abs(dayDifference(input.transaction.bookedAt, referenceDate)) <= 3) {
    score += 10;
    reasons.push("date_within_3_days");
  }
  return { score, reasons };
}

export async function listFinancialReconciliation(input: {
  legalEntityId?: string;
  status?: string;
  classification?: string;
  query?: string;
  from?: Date;
  to?: Date;
  page?: number;
  take?: number;
}) {
  const take = Math.min(Math.max(input.take || 30, 1), 50);
  const page = Math.max(input.page || 1, 1);
  const where: Prisma.FinancialBankTransactionWhereInput = {
    ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
    ...(input.status ? { reconciliationStatus: input.status } : {}),
    ...(input.classification ? { classification: input.classification } : {}),
    ...(input.from || input.to ? { bookedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
    ...(input.query ? {
      OR: [
        { description: { contains: input.query } },
        { paymentDetails: { contains: input.query } },
        { payerName: { contains: input.query } },
        { beneficiaryName: { contains: input.query } },
        { merchantName: { contains: input.query } },
        { documentReference: { contains: input.query } }
      ]
    } : {})
  };
  const [total, transactions, entities] = await Promise.all([
    prisma.financialBankTransaction.count({ where }),
    prisma.financialBankTransaction.findMany({
      where,
      orderBy: [{ bookedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        legalEntityId: true,
        bookedAt: true,
        valueDate: true,
        currency: true,
        debitAmount: true,
        creditAmount: true,
        description: true,
        documentReference: true,
        bankReference: true,
        payerName: true,
        payerIban: true,
        payerTaxId: true,
        beneficiaryName: true,
        beneficiaryIban: true,
        beneficiaryTaxId: true,
        paymentDetails: true,
        merchantName: true,
        classification: true,
        reconciliationStatus: true,
        legalEntity: { select: { code: true, legalName: true } },
        receivablePayments: {
          where: { status: ACTIVE },
          select: { id: true, amount: true, receivableId: true, receivable: { select: { invoiceNumber: true, clientName: true } } }
        },
        payablePayments: {
          where: { status: ACTIVE },
          select: { id: true, amount: true, payableId: true, verificationStatus: true, payable: { select: { invoiceNumber: true, supplierName: true } } }
        }
      }
    }),
    prisma.financialLegalEntity.findMany({ where: { active: true }, select: { id: true, code: true, legalName: true }, orderBy: { legalName: "asc" } })
  ]);
  const combinations = uniqueCombinations(transactions.map((transaction) => ({ legalEntityId: transaction.legalEntityId, currency: transaction.currency })));
  const [receivables, payables, aliases] = combinations.length ? await Promise.all([
    prisma.financialReceivable.findMany({
      where: {
        includedInReport: true,
        remainingAmount: { gt: new Prisma.Decimal("0.01") },
        OR: combinations,
        status: { notIn: ["cancelled", "archived"] }
      },
      select: {
        id: true, legalEntityId: true, currency: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
        invoicedAmount: true, remainingAmount: true, clientName: true, client: { select: { taxId: true } },
        partner: { select: { id: true, legalName: true } }
      },
      take: 5000
    }),
    prisma.financialPayable.findMany({
      where: {
        includedInReport: true,
        remainingAmount: { gt: new Prisma.Decimal("0.01") },
        OR: combinations,
        status: { notIn: ["cancelled", "archived"] }
      },
      select: {
        id: true, legalEntityId: true, currency: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
        amountToPay: true, remainingAmount: true, supplierName: true, supplier: { select: { taxId: true } },
        partner: { select: { id: true, legalName: true } }
      },
      take: 5000
    }),
    prisma.financialPartnerAlias.findMany({
      where: { legalEntityId: { in: [...new Set(combinations.map((item) => item.legalEntityId))] } },
      select: { legalEntityId: true, partnerId: true, alias: true },
      take: 5000
    })
  ]) : [[], [], []];
  const aliasesByPartner = new Map<string, string[]>();
  aliases.forEach((alias) => aliasesByPartner.set(alias.partnerId, [...(aliasesByPartner.get(alias.partnerId) || []), alias.alias]));
  const items = transactions.map((transaction) => {
    const direction: ReconciliationDirection | null = transaction.creditAmount.greaterThan(0)
      ? "receivable"
      : transaction.debitAmount.greaterThan(0)
        ? "payable"
        : null;
    const amount = direction === "receivable" ? transaction.creditAmount : transaction.debitAmount;
    const candidates = direction === "receivable" ? receivables : payables;
    const scored = direction ? candidates
      .filter((candidate) => candidate.legalEntityId === transaction.legalEntityId && candidate.currency === transaction.currency)
      .map((candidate) => {
        const isReceivable = "invoicedAmount" in candidate;
        const partner = candidate.partner;
        const score = scoreReconciliationCandidate({
          transaction: { ...transaction, amount },
          candidate: {
            amountRemaining: candidate.remainingAmount || 0,
            invoiceNumber: candidate.invoiceNumber,
            issueDate: candidate.invoiceDate,
            dueDate: candidate.dueDate,
            taxId: isReceivable ? candidate.client?.taxId : candidate.supplier?.taxId,
            partnerName: partner?.legalName || (isReceivable ? candidate.clientName : candidate.supplierName),
            aliases: partner ? aliasesByPartner.get(partner.id) : []
          },
          direction
        });
        return {
          id: candidate.id,
          direction,
          documentNumber: candidate.invoiceNumber,
          partnerName: isReceivable ? candidate.clientName : candidate.supplierName,
          totalAmount: decimalString(isReceivable ? candidate.invoicedAmount : candidate.amountToPay),
          remainingAmount: decimalString(candidate.remainingAmount),
          currency: candidate.currency,
          score: score.score,
          reasons: score.reasons
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8) : [];
    const ambiguousTop = scored.length > 1 && scored[0].score === scored[1].score;
    const suggestionStatus = !direction || EXCLUDED_CLASSIFICATIONS.includes(transaction.classification)
      ? "ignored"
      : !scored.length
        ? "unmatched"
        : scored[0].score >= 80 && !ambiguousTop
          ? "matched"
          : scored[0].score >= 50
            ? "suggested"
            : "unmatched";
    if (ambiguousTop && scored[0]) scored[0].reasons = [...scored[0].reasons, "multiple_candidates"];
    const allocations = [
      ...transaction.receivablePayments.map((payment) => ({ id: payment.id, direction: "receivable", documentId: payment.receivableId, documentNumber: payment.receivable.invoiceNumber, partnerName: payment.receivable.clientName, amount: decimalString(payment.amount), verificationStatus: "verified" })),
      ...transaction.payablePayments.map((payment) => ({ id: payment.id, direction: "payable", documentId: payment.payableId, documentNumber: payment.payable.invoiceNumber, partnerName: payment.payable.supplierName, amount: decimalString(payment.amount), verificationStatus: payment.verificationStatus }))
    ];
    const allocatedAmount = allocations.reduce((sum, allocation) => sum.plus(allocation.amount), money(0));
    return {
      id: transaction.id,
      entity: transaction.legalEntity,
      bookedAt: transaction.bookedAt.toISOString(),
      valueDate: transaction.valueDate?.toISOString() || null,
      currency: transaction.currency,
      amount: decimalString(amount),
      debitAmount: decimalString(transaction.debitAmount),
      creditAmount: decimalString(transaction.creditAmount),
      allocatedAmount: allocatedAmount.toFixed(2),
      availableAmount: Prisma.Decimal.max(amount.minus(allocatedAmount), 0).toFixed(2),
      description: transaction.description,
      documentReference: transaction.documentReference,
      payerName: transaction.payerName,
      beneficiaryName: transaction.beneficiaryName,
      merchantName: transaction.merchantName,
      classification: transaction.classification,
      reconciliationStatus: transaction.reconciliationStatus,
      direction,
      suggestionStatus,
      suggestions: scored,
      allocations
    };
  });
  return { entities, items, pagination: { page, take, total, totalPages: Math.max(1, Math.ceil(total / take)) } };
}

export async function financialReconciliationSummary(input: { legalEntityId?: string; from?: Date; to?: Date }) {
  const transactionWhere: Prisma.FinancialBankTransactionWhereInput = {
    ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
    ...(input.from || input.to ? { bookedAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {})
  };
  const documentScope = {
    ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}),
    ...(input.from || input.to ? { invoiceDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {})
  };
  const receivableWhere: Prisma.FinancialReceivableWhereInput = documentScope;
  const payableWhere: Prisma.FinancialPayableWhereInput = documentScope;
  const [entities, partnerRoles, receivables, payables, receivableStatuses, payableStatuses, payablePayments, bankGroups, unmatched] = await Promise.all([
    prisma.financialLegalEntity.findMany({ where: { active: true }, select: { id: true, code: true, legalName: true }, orderBy: { legalName: "asc" } }),
    prisma.financialPartnerRole.findMany({ where: { active: true, ...(input.legalEntityId ? { legalEntityId: input.legalEntityId } : {}) }, select: { partnerId: true, role: true } }),
    prisma.financialReceivable.groupBy({
      by: ["legalEntityId", "currency"],
      where: { ...receivableWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      _count: { _all: true }, _sum: { invoicedAmount: true, collectedAmount: true, remainingAmount: true }
    }),
    prisma.financialPayable.groupBy({
      by: ["legalEntityId", "currency"],
      where: { ...payableWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      _count: { _all: true }, _sum: { amountToPay: true, amountPaid: true, remainingAmount: true }
    }),
    prisma.financialReceivable.groupBy({
      by: ["legalEntityId", "currency", "status"],
      where: { ...receivableWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      _count: { _all: true }, _sum: { remainingAmount: true }
    }),
    prisma.financialPayable.groupBy({
      by: ["legalEntityId", "currency", "status"],
      where: { ...payableWhere, includedInReport: true, status: { notIn: ["cancelled", "archived"] } },
      _count: { _all: true }, _sum: { remainingAmount: true }
    }),
    prisma.financialPayablePayment.findMany({
      where: { status: ACTIVE, payable: { ...payableWhere, includedInReport: true } },
      select: { amount: true, currency: true, verificationStatus: true, payable: { select: { legalEntityId: true } } }
    }),
    prisma.financialBankTransaction.groupBy({
      by: ["legalEntityId", "currency", "classification"], where: transactionWhere,
      _count: { _all: true }, _sum: { debitAmount: true, creditAmount: true }
    }),
    prisma.financialBankTransaction.count({ where: { ...transactionWhere, reconciliationStatus: { in: ["unmatched", "partial", "conflict"] } } })
  ]);
  const customerPartners = new Set(partnerRoles.filter((role) => role.role === "customer").map((role) => role.partnerId));
  const supplierPartners = new Set(partnerRoles.filter((role) => role.role === "supplier").map((role) => role.partnerId));
  const both = [...customerPartners].filter((id) => supplierPartners.has(id)).length;
  const payableVerification = groupMoney(payablePayments, (row) => `${row.payable.legalEntityId || "unknown"}|${row.currency}|${row.verificationStatus}`);
  return {
    asOf: new Date().toISOString(),
    entities,
    partners: { customers: customerPartners.size, suppliers: supplierPartners.size, both },
    receivables: receivables.map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, count: row._count._all, invoiced: decimalString(row._sum.invoicedAmount), collected: decimalString(row._sum.collectedAmount), remaining: decimalString(row._sum.remainingAmount) })),
    payables: payables.map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, count: row._count._all, invoiced: decimalString(row._sum.amountToPay), paid: decimalString(row._sum.amountPaid), remaining: decimalString(row._sum.remainingAmount) })),
    receivableStatuses: receivableStatuses.map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, status: row.status, count: row._count._all, remaining: decimalString(row._sum.remainingAmount) })),
    payableStatuses: payableStatuses.map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, status: row.status, count: row._count._all, remaining: decimalString(row._sum.remainingAmount) })),
    payableVerification,
    bank: bankGroups.map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, classification: row.classification, count: row._count._all, debit: decimalString(row._sum.debitAmount), credit: decimalString(row._sum.creditAmount) })),
    unreconciledTransactions: unmatched
  };
}

export function excludedBankClassification(classification: string) {
  return EXCLUDED_CLASSIFICATIONS.includes(classification);
}

function uniqueCombinations(values: Array<{ legalEntityId: string; currency: string }>) {
  return [...new Map(values.map((value) => [`${value.legalEntityId}|${value.currency}`, value])).values()];
}

function groupMoney<T>(rows: T[], key: (row: T) => string) {
  const result = new Map<string, Prisma.Decimal>();
  rows.forEach((row) => result.set(key(row), (result.get(key(row)) || money(0)).plus((row as { amount: Prisma.Decimal }).amount)));
  return [...result].map(([bucket, amount]) => {
    const [legalEntityId, currency, verificationStatus] = bucket.split("|");
    return { legalEntityId: legalEntityId === "unknown" ? null : legalEntityId, currency, verificationStatus, amount: amount.toFixed(2) };
  });
}

function decimalString(value: Prisma.Decimal.Value | null | undefined) {
  return money(value).toFixed(2);
}

function dayDifference(left: Date, right: Date) {
  return Math.round((utcDay(left).getTime() - utcDay(right).getTime()) / 86_400_000);
}

function utcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function normalizeSearchText(value: unknown) {
  return normalizeClientName(String(value || "")).replace(/[^a-z0-9]+/g, " ").trim();
}
