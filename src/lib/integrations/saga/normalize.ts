import { Prisma } from "@prisma/client";
import { normalizeReceivableInvoiceNumber } from "@/lib/receivables-domain";
import type { SagaCurrency, SagaIssuedInvoiceDto, SagaLegalEntityCode } from "@/lib/integrations/saga/contracts";

const entityCodes = new Set<SagaLegalEntityCode>(["FOCUS_MEDIA", "EXCELLENCE_MEDIA", "FOCUS_BG"]);

export function normalizeSagaInvoice(invoice: SagaIssuedInvoiceDto) {
  const legalEntityCode = normalizeSagaEntity(invoice.legalEntityCode);
  const currency = normalizeSagaCurrency(invoice.currency);
  const issueDate = normalizeSagaDate(invoice.issueDate, "data facturii");
  const dueDate = invoice.dueDate ? normalizeSagaDate(invoice.dueDate, "scadenta") : null;
  const netAmount = sagaMoney(invoice.netAmount);
  const vatAmount = sagaMoney(invoice.vatAmount);
  const grossAmount = sagaMoney(invoice.grossAmount);
  const outstandingAmount = sagaMoney(invoice.outstandingAmount);
  if (!netAmount.plus(vatAmount).equals(grossAmount)) throw new Error("SAGA_INVOICE_TOTAL_MISMATCH");
  if (outstandingAmount.isNegative()) throw new Error("SAGA_NEGATIVE_OUTSTANDING");

  const lines = invoice.lines.map((line) => {
    const net = sagaMoney(line.netAmount);
    const vat = sagaMoney(line.vatAmount);
    const gross = sagaMoney(line.grossAmount);
    if (!net.plus(vat).equals(gross)) throw new Error("SAGA_LINE_TOTAL_MISMATCH");
    return { ...line, netAmount: net.toFixed(2), vatAmount: vat.toFixed(2), grossAmount: gross.toFixed(2) };
  });

  return {
    ...invoice,
    legalEntityCode,
    currency,
    issueDate,
    dueDate,
    number: invoice.number.trim(),
    normalizedInvoiceNumber: normalizeReceivableInvoiceNumber([invoice.series, invoice.number].filter(Boolean).join(" ")),
    customerTaxId: normalizeTaxId(invoice.customerTaxId),
    netAmount: netAmount.toFixed(2),
    vatAmount: vatAmount.toFixed(2),
    grossAmount: grossAmount.toFixed(2),
    outstandingAmount: outstandingAmount.toFixed(2),
    lines
  };
}

export function normalizeSagaCurrency(value: string): SagaCurrency {
  const currency = String(value || "").trim().toUpperCase();
  if (currency !== "RON" && currency !== "EUR") throw new Error("SAGA_UNSUPPORTED_CURRENCY");
  return currency;
}

export function normalizeSagaEntity(value: string): SagaLegalEntityCode {
  const code = String(value || "").trim().toUpperCase() as SagaLegalEntityCode;
  if (!entityCodes.has(code)) throw new Error("SAGA_UNKNOWN_LEGAL_ENTITY");
  return code;
}

export function normalizeSagaDate(value: string, field: string) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || Number.isNaN(new Date(`${match[1]}T00:00:00.000Z`).getTime())) throw new Error(`SAGA_INVALID_${field.toUpperCase().replace(/\W+/g, "_")}`);
  return match[1];
}

export function normalizeTaxId(value?: string | null) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^RO/, "");
  return normalized || null;
}

export function sagaMoney(value: Prisma.Decimal.Value) {
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.decimalPlaces() > 2) throw new Error("SAGA_INVALID_MONEY");
  return amount.toDecimalPlaces(2);
}
