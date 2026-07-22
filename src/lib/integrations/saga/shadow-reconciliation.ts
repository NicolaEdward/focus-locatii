import { Prisma } from "@prisma/client";
import { emitStructuredLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { normalizeReceivableInvoiceNumber } from "@/lib/receivables-domain";
import { assertSagaShadowRunAllowed } from "@/lib/integrations/saga/config";
import type { SagaCollectionDto, SagaIssuedInvoiceDto, SagaShadowSnapshot, SagaSyncResult } from "@/lib/integrations/saga/contracts";
import { sagaShadowFixture } from "@/lib/integrations/saga/fixtures";
import { normalizeSagaDate, normalizeSagaInvoice, normalizeTaxId, sagaMoney } from "@/lib/integrations/saga/normalize";

const tolerance = new Prisma.Decimal("0.01");

export type SagaCanonicalInvoice = {
  id: string;
  companyCode: string | null;
  invoiceNumber: string | null;
  normalizedInvoiceNumber: string | null;
  invoiceDate: Date | null;
  currency: string | null;
  invoicedAmount: Prisma.Decimal | null;
  remainingAmount: Prisma.Decimal | null;
  clientTaxId: string | null;
};

export type SagaCanonicalPayment = {
  id: string;
  receivableId: string;
  amount: Prisma.Decimal;
  currency: string;
  receivedAt: Date;
  paymentReference: string | null;
  source: string;
  status: string;
};

export type SagaReconciliationIssue = {
  category: "PROBABLE_MATCH" | "NEW_INVOICE" | "CONFLICTING_TOTALS" | "CONFLICTING_CUSTOMER" | "CONFLICTING_CURRENCY" | "CANCELLED_OR_STORNO" | "MISSING_EXTERNAL_ID" | "DUPLICATE_EXTERNAL_INVOICE" | "UNMATCHED_PAYMENT" | "EXACT_PAYMENT_MATCH" | "NEW_PAYMENT" | "REVERSED_PAYMENT" | "POTENTIAL_DUPLICATE_PAYMENT";
  legalEntityCode: string;
  reference: string;
  message: string;
};

export type SagaShadowReport = {
  summary: SagaSyncResult;
  source: "FIXTURE";
  categories: Record<SagaReconciliationIssue["category"], number> & { EXACT_MATCH: number };
  totals: Array<{ legalEntityCode: string; currency: string; invoiceCount: number; net: string; vat: string; gross: string; outstanding: string; collections: string }>;
  issues: SagaReconciliationIssue[];
  paymentLedgerPolicy: "MANUAL_LEDGER_AUTHORITATIVE";
  canonicalWrites: 0;
  rawPayloadIncluded: false;
};

export async function runSagaShadowReconciliation(now = new Date()): Promise<SagaShadowReport> {
  assertSagaShadowRunAllowed();
  const startedAt = Date.now();
  const [invoices, payments] = await Promise.all([
    prisma.financialReceivable.findMany({
      where: { includedInReport: true },
      select: {
        id: true, companyCode: true, invoiceNumber: true, normalizedInvoiceNumber: true,
        invoiceDate: true, currency: true, invoicedAmount: true, remainingAmount: true,
        client: { select: { taxId: true } }
      },
      take: 5000
    }),
    prisma.financialReceivablePayment.findMany({
      where: { status: "active" },
      select: { id: true, receivableId: true, amount: true, currency: true, receivedAt: true, paymentReference: true, source: true, status: true },
      take: 10000
    })
  ]);
  const report = reconcileSagaSnapshot(
    sagaShadowFixture(now),
    invoices.map((row) => ({ ...row, clientTaxId: row.client?.taxId || null })),
    payments,
    now
  );
  emitStructuredLog("info", "saga_shadow_completed", {
    operation: "saga.shadow.reconcile",
    durationMs: Date.now() - startedAt,
    metrics: {
      scannedCount: report.summary.recordsRead,
      conflictCount: report.summary.conflicts,
      receivableCount: invoices.length
    }
  });
  return report;
}

export function reconcileSagaSnapshot(
  snapshot: SagaShadowSnapshot,
  canonicalInvoices: SagaCanonicalInvoice[],
  canonicalPayments: SagaCanonicalPayment[],
  now = new Date()
): SagaShadowReport {
  const issues: SagaReconciliationIssue[] = [];
  const categories = emptyCategories();
  const normalizedInvoices: ReturnType<typeof normalizeSagaInvoice>[] = [];
  let rejected = 0;

  for (const invoice of snapshot.invoices) {
    try {
      normalizedInvoices.push(normalizeSagaInvoice(invoice));
    } catch {
      rejected += 1;
    }
  }

  const externalIdentities = new Map<string, number>();
  for (const invoice of normalizedInvoices) {
    const externalIdentity = invoice.externalId || invoice.guid;
    if (!externalIdentity) {
      addIssue("MISSING_EXTERNAL_ID", invoice, "Factura SAGA nu are ID/GUID extern stabil.");
    } else {
      const key = `${invoice.legalEntityCode}|${externalIdentity}`;
      externalIdentities.set(key, (externalIdentities.get(key) || 0) + 1);
    }
    if (invoice.cancelled || invoice.storno) addIssue("CANCELLED_OR_STORNO", invoice, "Factura este anulata sau storno si necesita decizie umana.");
  }
  for (const [key, count] of externalIdentities) {
    if (count > 1) {
      const [legalEntityCode, reference] = key.split("|");
      categories.DUPLICATE_EXTERNAL_INVOICE += 1;
      issues.push({ category: "DUPLICATE_EXTERNAL_INVOICE", legalEntityCode, reference, message: `${count} facturi folosesc aceeasi identitate externa.` });
    }
  }

  const externalToCanonical = new Map<string, string>();
  for (const invoice of normalizedInvoices) {
    if (invoice.cancelled || invoice.storno) continue;
    const externalIdentity = invoice.externalId || invoice.guid;
    if (externalIdentity && (externalIdentities.get(`${invoice.legalEntityCode}|${externalIdentity}`) || 0) > 1) continue;
    const sameNumber = canonicalInvoices.filter((candidate) =>
      candidate.companyCode === invoice.legalEntityCode &&
      normalizeReceivableInvoiceNumber(candidate.normalizedInvoiceNumber || candidate.invoiceNumber) === invoice.normalizedInvoiceNumber
    );
    if (!sameNumber.length) {
      addIssue("NEW_INVOICE", invoice, "Factura nu exista in registrul canonic.");
      continue;
    }
    const sameCurrency = sameNumber.filter((candidate) => candidate.currency === invoice.currency);
    if (!sameCurrency.length) {
      addIssue("CONFLICTING_CURRENCY", invoice, "Numarul exista, dar moneda nu coincide.");
      continue;
    }
    const exactDate = sameCurrency.filter((candidate) => dateKey(candidate.invoiceDate) === invoice.issueDate);
    if (exactDate.length !== 1) {
      addIssue("PROBABLE_MATCH", invoice, exactDate.length > 1 ? "Mai multe facturi canonice corespund identitatii." : "Numarul si moneda coincid, dar data emiterii difera.");
      continue;
    }
    const candidate = exactDate[0];
    if (candidate.clientTaxId && invoice.customerTaxId && normalizeTaxId(candidate.clientTaxId) !== invoice.customerTaxId) {
      addIssue("CONFLICTING_CUSTOMER", invoice, "CUI-ul clientului nu coincide.");
      continue;
    }
    if (!withinTolerance(candidate.invoicedAmount, invoice.grossAmount)) {
      addIssue("CONFLICTING_TOTALS", invoice, "Totalul brut SAGA nu coincide cu valoarea facturii canonice.");
      continue;
    }
    categories.EXACT_MATCH += 1;
    if (externalIdentity) externalToCanonical.set(`${invoice.legalEntityCode}|${externalIdentity}`, candidate.id);
  }

  for (const collection of snapshot.collections) reconcileCollection(collection);

  const totals = buildTotals(normalizedInvoices, snapshot.collections);
  const manualPaymentsPendingReconciliation = canonicalPayments.filter((payment) => payment.status === "active" && /^manual/i.test(payment.source)).length;
  const conflicts = categories.CONFLICTING_TOTALS + categories.CONFLICTING_CUSTOMER + categories.CONFLICTING_CURRENCY + categories.DUPLICATE_EXTERNAL_INVOICE;
  return {
    summary: {
      mode: "SHADOW_READ_ONLY",
      generatedAt: now.toISOString(),
      recordsRead: snapshot.customers.length + snapshot.invoices.length + snapshot.collections.length,
      accepted: normalizedInvoices.length + snapshot.collections.length,
      rejected,
      exactMatches: categories.EXACT_MATCH,
      probableMatches: categories.PROBABLE_MATCH,
      newInvoices: categories.NEW_INVOICE,
      exactPaymentMatches: categories.EXACT_PAYMENT_MATCH,
      newPayments: categories.NEW_PAYMENT,
      reversedPayments: categories.REVERSED_PAYMENT,
      conflicts,
      unmatchedPayments: categories.UNMATCHED_PAYMENT,
      potentialDuplicatePayments: categories.POTENTIAL_DUPLICATE_PAYMENT,
      manualPaymentsPendingReconciliation
    },
    source: snapshot.source,
    categories,
    totals,
    issues: issues.slice(0, 100),
    paymentLedgerPolicy: "MANUAL_LEDGER_AUTHORITATIVE",
    canonicalWrites: 0,
    rawPayloadIncluded: false
  };

  function addIssue(category: SagaReconciliationIssue["category"], invoice: SagaIssuedInvoiceDto | ReturnType<typeof normalizeSagaInvoice>, message: string) {
    categories[category] += 1;
    issues.push({ category, legalEntityCode: invoice.legalEntityCode, reference: invoiceReference(invoice), message });
  }

  function reconcileCollection(collection: SagaCollectionDto) {
    if (collection.reversed) {
      categories.REVERSED_PAYMENT += 1;
      issues.push({ category: "REVERSED_PAYMENT", legalEntityCode: collection.legalEntityCode, reference: collection.externalId || "fara-id", message: "Incasarea este inversata si necesita verificare umana." });
      return;
    }
    const normalizedDate = normalizeSagaDate(collection.receivedAt, "data incasarii");
    const invoiceId = collection.invoiceExternalId
      ? externalToCanonical.get(`${collection.legalEntityCode}|${collection.invoiceExternalId}`)
      : null;
    if (!invoiceId) {
      categories.UNMATCHED_PAYMENT += 1;
      issues.push({ category: "UNMATCHED_PAYMENT", legalEntityCode: collection.legalEntityCode, reference: collection.externalId || "fara-id", message: "Incasarea nu are o factura canonica identificata sigur." });
      return;
    }
    const amount = sagaMoney(collection.amount);
    const candidates = canonicalPayments.filter((payment) => payment.receivableId === invoiceId && payment.status === "active" && payment.currency === collection.currency && payment.amount.equals(amount) && dateKey(payment.receivedAt) === normalizedDate);
    if (!candidates.length) {
      categories.NEW_PAYMENT += 1;
      issues.push({ category: "NEW_PAYMENT", legalEntityCode: collection.legalEntityCode, reference: collection.externalId || "fara-id", message: "Incasarea nu exista in ledgerul manual si ramane propunere de reconciliere." });
      return;
    }
    const strong = collection.reference && candidates.some((payment) => payment.paymentReference === collection.reference);
    if (strong) {
      categories.EXACT_PAYMENT_MATCH += 1;
    } else {
      categories.POTENTIAL_DUPLICATE_PAYMENT += 1;
      issues.push({ category: "POTENTIAL_DUPLICATE_PAYMENT", legalEntityCode: collection.legalEntityCode, reference: collection.externalId || "fara-id", message: "Suma si data coincid cu o plata locala, dar referinta nu ofera dovada suficienta pentru reconciliere automata." });
    }
  }
}

function buildTotals(invoices: ReturnType<typeof normalizeSagaInvoice>[], collections: SagaCollectionDto[]) {
  const rows = new Map<string, { legalEntityCode: string; currency: string; invoiceCount: number; net: Prisma.Decimal; vat: Prisma.Decimal; gross: Prisma.Decimal; outstanding: Prisma.Decimal; collections: Prisma.Decimal }>();
  for (const invoice of invoices) {
    const row = totalRow(invoice.legalEntityCode, invoice.currency);
    row.invoiceCount += 1;
    row.net = row.net.plus(invoice.netAmount);
    row.vat = row.vat.plus(invoice.vatAmount);
    row.gross = row.gross.plus(invoice.grossAmount);
    row.outstanding = row.outstanding.plus(invoice.outstandingAmount);
  }
  for (const collection of collections) {
    const row = totalRow(collection.legalEntityCode, collection.currency);
    row.collections = row.collections.plus(collection.amount);
  }
  return [...rows.values()].map((row) => ({ ...row, net: row.net.toFixed(2), vat: row.vat.toFixed(2), gross: row.gross.toFixed(2), outstanding: row.outstanding.toFixed(2), collections: row.collections.toFixed(2) }));

  function totalRow(legalEntityCode: string, currency: string) {
    const key = `${legalEntityCode}|${currency}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const row = { legalEntityCode, currency, invoiceCount: 0, net: new Prisma.Decimal(0), vat: new Prisma.Decimal(0), gross: new Prisma.Decimal(0), outstanding: new Prisma.Decimal(0), collections: new Prisma.Decimal(0) };
    rows.set(key, row);
    return row;
  }
}

function emptyCategories(): SagaShadowReport["categories"] {
  return { EXACT_MATCH: 0, PROBABLE_MATCH: 0, NEW_INVOICE: 0, CONFLICTING_TOTALS: 0, CONFLICTING_CUSTOMER: 0, CONFLICTING_CURRENCY: 0, CANCELLED_OR_STORNO: 0, MISSING_EXTERNAL_ID: 0, DUPLICATE_EXTERNAL_INVOICE: 0, UNMATCHED_PAYMENT: 0, EXACT_PAYMENT_MATCH: 0, NEW_PAYMENT: 0, REVERSED_PAYMENT: 0, POTENTIAL_DUPLICATE_PAYMENT: 0 };
}

function invoiceReference(invoice: { series?: string | null; number: string }) {
  return [invoice.series, invoice.number].filter(Boolean).join(" ");
}

function dateKey(value: Date | null) {
  return value?.toISOString().slice(0, 10) || null;
}

function withinTolerance(value: Prisma.Decimal | null, expected: Prisma.Decimal.Value) {
  if (value == null) return false;
  return value.minus(expected).abs().lessThanOrEqualTo(tolerance);
}
