import crypto from "crypto";
import * as XLSX from "xlsx";
import type { Prisma } from "@prisma/client";
import { normalizeClientName, normalizeInvoiceNumber } from "@/lib/clients";
import { companyCodeForEntity, companyEntityOrThrow, type CompanyEntity } from "@/lib/company-entities";
import { financialStatus } from "@/lib/financial-review";
import { roundMoney } from "@/lib/money";

export type SmartBillReportType = "customer_invoices" | "supplier_documents";
export type SmartBillPreviewAction =
  | "AUTO_MATCHED"
  | "PROPOSE_CREATE_CLIENT"
  | "PROPOSE_CREATE_SUPPLIER"
  | "AUTO_LINK_ADJUSTMENT"
  | "ADJUSTMENT_NEEDS_REVIEW"
  | "DUPLICATE"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "IGNORED";
export type SmartBillEntityKind = "client" | "supplier";
export type SmartBillAdjustmentKind = "CREDIT_NOTE" | "STORNO" | "DISCOUNT_ADJUSTMENT";

export type SmartBillCompanyContext = {
  companyName: CompanyEntity;
  companyCode: string;
};

export type SmartBillCustomerInvoiceRow = {
  kind: "customer_invoice";
  rowNumber: number;
  sheetName: string;
  clientName: string;
  fiscalCode: string | null;
  normalizedFiscalCode: string | null;
  address: string | null;
  invoiceNumber: string;
  normalizedInvoiceNumber: string;
  issueDate: Date | null;
  dueDate: Date | null;
  sourceStatus: string | null;
  status: string;
  ignored: boolean;
  currency: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  notes: string | null;
  raw: Record<string, unknown>;
  issues: string[];
  dedupeKey: string;
};

export type SmartBillSupplierDocumentRow = {
  kind: "supplier_document";
  rowNumber: number;
  sheetName: string;
  supplierName: string;
  fiscalCode: string | null;
  normalizedFiscalCode: string | null;
  documentNumber: string;
  normalizedInvoiceNumber: string;
  issueDate: Date | null;
  dueDate: Date | null;
  category: string | null;
  sourceStatus: string | null;
  status: string;
  ignored: boolean;
  currency: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  notes: string | null;
  raw: Record<string, unknown>;
  issues: string[];
  dedupeKey: string;
};

export type SmartBillParsedRow = SmartBillCustomerInvoiceRow | SmartBillSupplierDocumentRow;

export type SmartBillParsedReport = {
  reportType: SmartBillReportType;
  fileHash: string;
  sheets: string[];
  headerRow: number;
  detectedColumns: string[];
  rows: SmartBillParsedRow[];
  invalidRows: SmartBillParsedRow[];
};

export type SmartBillMatchEntity = {
  id: string;
  name: string;
  normalizedName?: string | null;
  taxId?: string | null;
  accountOwnerUserId?: string | null;
};

export type SmartBillExistingFinancialRow = {
  id: string;
  companyName?: string | null;
  companyCode?: string | null;
  normalizedInvoiceNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: Date | string | null;
  dueDate?: Date | string | null;
  clientId?: string | null;
  supplierId?: string | null;
  clientName?: string | null;
  supplierName?: string | null;
  entityTaxId?: string | null;
  entityNormalizedName?: string | null;
  currency?: string | null;
  amount?: number | string | Prisma.Decimal | null;
  remainingAmount?: number | string | Prisma.Decimal | null;
  paidOrCollectedAmount?: number | string | Prisma.Decimal | null;
  rawRowJson?: unknown;
  includedInReport?: boolean | null;
  status?: string | null;
};

export type SmartBillAdjustmentCandidate = {
  id: string;
  documentNumber: string | null;
  entityName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  totalAmount: number;
  remainingAmount: number;
  matchConfidence: "high" | "medium" | "low";
  reason: string;
};

export type SmartBillPreviewRow = {
  rowNumber: number;
  sheetName: string;
  companyName: string;
  companyCode: string;
  kind: SmartBillParsedRow["kind"];
  entityKind: SmartBillEntityKind;
  entityName: string;
  fiscalCode: string | null;
  normalizedFiscalCode: string | null;
  documentNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  sourceStatus: string | null;
  mappedStatus: string;
  currency: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  matchedEntityId: string | null;
  matchedEntityName: string | null;
  duplicateId: string | null;
  adjustmentKind: SmartBillAdjustmentKind | null;
  linkedFinancialRowId: string | null;
  linkedDocumentNumber: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  adjustmentReason: string | null;
  adjustmentCandidates: SmartBillAdjustmentCandidate[];
  proposedAction: SmartBillPreviewAction;
  warning: string | null;
  errors: string[];
  dedupeKey: string;
};

export type SmartBillPreviewSummary = {
  reportType: SmartBillReportType;
  rowCount: number;
  matchedCount: number;
  createClientCount: number;
  createSupplierCount: number;
  duplicateCount: number;
  needsReviewCount: number;
  invalidCount: number;
  ignoredCount: number;
  autoLinkedAdjustmentCount: number;
  adjustmentNeedsReviewCount: number;
  totalReceivable: number;
  totalPayable: number;
  totalReceivableByCurrency: Record<string, number>;
  totalPayableByCurrency: Record<string, number>;
  buckets: Record<SmartBillPreviewAction, number>;
};

export type SmartBillPreviewResult = {
  reportType: SmartBillReportType;
  companyName: string;
  companyCode: string;
  fileName: string;
  fileHash: string;
  generatedAt: string;
  detectedColumns: string[];
  rows: SmartBillPreviewRow[];
  summary: SmartBillPreviewSummary;
  importToken: string;
};

export type SmartBillTokenPayload = {
  version: 1;
  reportType: SmartBillReportType;
  companyName: CompanyEntity;
  companyCode: string;
  fileName: string;
  fileHash: string;
  generatedAt: string;
  rows: SmartBillParsedRow[];
};

export type SmartBillPreviewContext = {
  clients?: SmartBillMatchEntity[];
  suppliers?: SmartBillMatchEntity[];
  receivables?: SmartBillExistingFinancialRow[];
  payables?: SmartBillExistingFinancialRow[];
  now?: Date;
};

const customerColumns = {
  clientName: ["client", "nume client", "denumire client"],
  fiscalCode: ["cif", "cui", "cod fiscal"],
  address: ["adresa"],
  invoiceNumber: ["factura", "numar factura", "nr factura", "document"],
  issueDate: ["data emiterii", "data emitere", "data factura"],
  dueDate: ["data scadentei", "scadenta", "data scadenta"],
  status: ["status", "stare"],
  currency: ["moneda"],
  netAmount: ["valoare fara tva", "total fara tva", "baza"],
  vatAmount: ["valoare tva", "tva"],
  totalAmount: ["valoare totala", "total"],
  notes: ["observatii", "observatii factura"]
};

const supplierColumns = {
  documentNumber: ["document", "numar document", "nr document"],
  supplierName: ["denumire furnizor", "furnizor", "nume furnizor"],
  fiscalCode: ["cif", "cui", "cod fiscal"],
  issueDate: ["data doc", "data document", "data factura"],
  dueDate: ["data scadentei", "scadenta", "data scadenta"],
  category: ["categoria", "categorie"],
  netAmount: ["valoare fara tva", "total fara tva", "baza"],
  vatAmount: ["tva", "valoare tva"],
  totalAmount: ["valoare totala", "total"],
  currency: ["moneda"],
  notes: ["observatii"],
  status: ["status", "stare"]
};

export function parseSmartBillCustomerInvoices(input: Buffer | Uint8Array | ArrayBuffer) {
  return parseSmartBillWorkbook(input, "customer_invoices");
}

export function parseSmartBillSupplierDocuments(input: Buffer | Uint8Array | ArrayBuffer) {
  return parseSmartBillWorkbook(input, "supplier_documents");
}

export function parseSmartBillWorkbook(input: Buffer | Uint8Array | ArrayBuffer, reportType: SmartBillReportType): SmartBillParsedReport {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input as ArrayBuffer);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheetName || !sheet) {
    throw new Error("Fisierul SmartBill nu contine foi Excel.");
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
  const aliases = reportType === "customer_invoices" ? customerColumns : supplierColumns;
  const headerIndex = findHeaderRow(rows, aliases);
  if (headerIndex < 0) {
    throw new Error("Nu am gasit antetul SmartBill asteptat in fisier.");
  }
  const header = rows[headerIndex].map((value) => cleanCell(value));
  const columnMap = mapColumns(header, aliases);
  const parsedRows = rows.slice(headerIndex + 1)
    .map((row, index) => parseSmartBillRow({
      row,
      header,
      columnMap,
      rowNumber: headerIndex + index + 2,
      sheetName,
      reportType
    }))
    .filter(Boolean) as SmartBillParsedRow[];

  return {
    reportType,
    fileHash: smartBillFileHash(buffer),
    sheets: workbook.SheetNames,
    headerRow: headerIndex + 1,
    detectedColumns: header.filter(Boolean),
    rows: parsedRows,
    invalidRows: parsedRows.filter((row) => row.issues.length)
  };
}

export function normalizeFiscalCode(value: unknown) {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^RO\s*/i, "")
    .replace(/[\s.\-_/\\]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
}

export function normalizeCompanyName(value: unknown) {
  return normalizeClientName(String(value || ""));
}

export function resolveSmartBillCompanyContext(value?: string | null): SmartBillCompanyContext {
  const companyName = companyEntityOrThrow(value);
  const companyCode = companyCodeForEntity(companyName);
  if (!companyCode) {
    throw new Error("Firma SmartBill nu are cod financiar configurat.");
  }
  return { companyName, companyCode };
}

export function normalizeSmartBillDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfUtcDay(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const text = cleanCell(value);
  if (!text) return null;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime()) && /^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return startOfUtcDay(direct);
  const romanian = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!romanian) return null;
  const day = Number(romanian[1]);
  const month = Number(romanian[2]);
  const yearValue = Number(romanian[3]);
  const year = yearValue < 100 ? 2000 + yearValue : yearValue;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return parsed;
}

export function normalizeSmartBillMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  const text = cleanCell(value);
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || text.trim().startsWith("-");
  const stripped = text
    .replace(/\((.*)\)/, "$1")
    .replace(/[^\d,.-]/g, "")
    .replace(/\s+/g, "");
  const decimalComma = /,\d{1,2}$/.test(stripped);
  const normalized = decimalComma
    ? stripped.replace(/\./g, "").replace(",", ".")
    : stripped.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
}

export function mapSmartBillCustomerInvoiceStatus(value: unknown, input?: { totalAmount?: number; dueDate?: Date | null; now?: Date }) {
  const normalized = normalizeText(value);
  const total = input?.totalAmount ?? 0;
  if (total < 0) {
    return { status: "adjustment", collectedAmount: 0, remainingAmount: 0, ignored: false, needsReview: false };
  }
  if (["incasata", "incasat", "platita", "achitata"].includes(normalized)) {
    return { status: "collected", collectedAmount: total, remainingAmount: 0, ignored: false, needsReview: false };
  }
  if (["depasita", "restanta", "restant"].includes(normalized)) {
    return { status: "overdue", collectedAmount: 0, remainingAmount: Math.max(0, total), ignored: false, needsReview: false };
  }
  if (["emisa", "emisa client", "trimisa", "deschisa", "open"].includes(normalized)) {
    const remainingAmount = Math.max(0, total);
    return {
      status: financialStatus({ kind: "receivable", remainingAmount, paidOrCollected: 0, dueDate: input?.dueDate, now: input?.now }),
      collectedAmount: 0,
      remainingAmount,
      ignored: false,
      needsReview: false
    };
  }
  if (["anulata", "anulat", "ciorna", "draft"].includes(normalized)) {
    return { status: "cancelled", collectedAmount: 0, remainingAmount: 0, ignored: true, needsReview: false };
  }
  return { status: "needs_review", collectedAmount: 0, remainingAmount: Math.max(0, total), ignored: false, needsReview: true };
}

export function mapSmartBillSupplierDocumentStatus(value: unknown, input?: { totalAmount?: number; dueDate?: Date | null; now?: Date }) {
  const normalized = normalizeText(value);
  const total = input?.totalAmount ?? 0;
  if (total < 0) {
    return { status: "supplier_adjustment", paidAmount: 0, remainingAmount: 0, ignored: false, needsReview: true };
  }
  if (["platita", "achitata", "paid"].includes(normalized)) {
    return { status: "paid", paidAmount: total, remainingAmount: 0, ignored: false, needsReview: false };
  }
  if (["anulata", "anulat", "ciorna", "draft"].includes(normalized)) {
    return { status: "cancelled", paidAmount: 0, remainingAmount: 0, ignored: true, needsReview: false };
  }
  if (["nesalvata", "nesalvat", "in asteptare", "asteptare", "returnata", "returnat", "emisa", "open", "pending"].includes(normalized)) {
    const remainingAmount = Math.max(0, total);
    return {
      status: financialStatus({ kind: "payable", remainingAmount, paidOrCollected: 0, dueDate: input?.dueDate, now: input?.now }),
      paidAmount: 0,
      remainingAmount,
      ignored: false,
      needsReview: false
    };
  }
  return { status: "needs_review", paidAmount: 0, remainingAmount: Math.max(0, total), ignored: false, needsReview: true };
}

export function buildSmartBillPreview(input: {
  parsed: SmartBillParsedReport;
  fileName: string;
  companyContext: SmartBillCompanyContext;
  context?: SmartBillPreviewContext;
  includeToken?: boolean;
}) {
  const rows = input.parsed.rows.map((row) => previewRow(row, input.context || {}, input.companyContext, input.parsed.rows));
  const summary = summarizePreviewRows(input.parsed.reportType, rows);
  const generatedAt = new Date().toISOString();
  const payload: SmartBillTokenPayload = {
    version: 1,
    reportType: input.parsed.reportType,
    companyName: input.companyContext.companyName,
    companyCode: input.companyContext.companyCode,
    fileName: input.fileName,
    fileHash: input.parsed.fileHash,
    generatedAt,
    rows: input.parsed.rows
  };
  return {
    reportType: input.parsed.reportType,
    companyName: input.companyContext.companyName,
    companyCode: input.companyContext.companyCode,
    fileName: input.fileName,
    fileHash: input.parsed.fileHash,
    generatedAt,
    detectedColumns: input.parsed.detectedColumns,
    rows,
    summary,
    importToken: input.includeToken === false ? "" : createSmartBillImportToken(payload)
  } satisfies SmartBillPreviewResult;
}

export function createSmartBillImportToken(payload: SmartBillTokenPayload, secret = smartBillTokenSecret()) {
  const json = JSON.stringify(payload, (_key, value) => value instanceof Date ? value.toISOString() : value);
  const body = base64url(Buffer.from(json, "utf8"));
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySmartBillImportToken(
  token: string,
  secret = smartBillTokenSecret(),
  options: { now?: Date; maxAgeMs?: number } = {}
): SmartBillTokenPayload {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("Tokenul de import SmartBill este invalid.");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) throw new Error("Tokenul de import SmartBill nu mai este valid.");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SmartBillTokenPayload;
  if (parsed.version !== 1 || !parsed.reportType || !parsed.companyName || !parsed.companyCode || !Array.isArray(parsed.rows)) {
    throw new Error("Tokenul de import SmartBill este incomplet.");
  }
  const companyContext = resolveSmartBillCompanyContext(parsed.companyName);
  if (companyContext.companyCode !== parsed.companyCode) {
    throw new Error("Tokenul de import SmartBill are firma nevalida.");
  }
  const generatedAt = new Date(parsed.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("Tokenul de import SmartBill nu are data valida.");
  }
  const maxAgeMs = options.maxAgeMs ?? 4 * 60 * 60 * 1000;
  const now = options.now || new Date();
  if (now.getTime() - generatedAt.getTime() > maxAgeMs) {
    throw new Error("Preview-ul SmartBill a expirat. Genereaza un preview nou inainte de confirmare.");
  }
  parsed.rows = parsed.rows.map(rehydrateSmartBillRow);
  return parsed;
}

export function smartBillCustomerReceivableData(input: {
  row: SmartBillCustomerInvoiceRow;
  uploadId: string;
  companyContext: SmartBillCompanyContext;
  clientId: string | null;
  accountOwnerUserId?: string | null;
  reviewedByUserId?: string | null;
}) {
  const mapped = mapSmartBillCustomerInvoiceStatus(input.row.sourceStatus, {
    totalAmount: input.row.totalAmount,
    dueDate: input.row.dueDate
  });
  return {
    uploadId: input.uploadId,
    clientId: input.clientId,
    campaignId: null,
    accountOwnerUserId: input.accountOwnerUserId || null,
    companyName: input.companyContext.companyName,
    companyCode: input.companyContext.companyCode,
    invoiceNumber: input.row.invoiceNumber,
    normalizedInvoiceNumber: input.row.normalizedInvoiceNumber,
    invoiceDate: input.row.issueDate,
    clientName: input.row.clientName,
    dueDate: input.row.dueDate,
    invoicedAmount: input.row.totalAmount,
    collectedAmount: mapped.collectedAmount,
    remainingAmount: mapped.remainingAmount,
    collectedAt: mapped.status === "collected" ? input.row.dueDate || input.row.issueDate : null,
    currency: normalizedCurrency(input.row.currency),
    status: mapped.status,
    rawRowJson: smartBillRawJson(input.row, input.companyContext),
    needsReview: mapped.status === "needs_review" || !isSupportedCurrency(input.row.currency),
    includedInReport: !mapped.ignored,
    rowType: "smartbill_customer_invoice",
    reviewNote: mapped.status === "needs_review" ? "Status SmartBill necunoscut sau rand incomplet." : null,
    reviewedByUserId: input.reviewedByUserId || null,
    reviewedAt: new Date()
  };
}

export function smartBillSupplierPayableData(input: {
  row: SmartBillSupplierDocumentRow;
  uploadId: string;
  companyContext: SmartBillCompanyContext;
  supplierId: string | null;
  reviewedByUserId?: string | null;
}) {
  const mapped = mapSmartBillSupplierDocumentStatus(input.row.sourceStatus, {
    totalAmount: input.row.totalAmount,
    dueDate: input.row.dueDate
  });
  return {
    uploadId: input.uploadId,
    supplierId: input.supplierId,
    companyName: input.companyContext.companyName,
    companyCode: input.companyContext.companyCode,
    supplierName: input.row.supplierName,
    invoiceNumber: input.row.documentNumber,
    normalizedInvoiceNumber: input.row.normalizedInvoiceNumber,
    invoiceDate: input.row.issueDate,
    documentDescription: input.row.category || input.row.notes || null,
    dueDate: input.row.dueDate,
    amountToPay: input.row.totalAmount,
    amountPaid: mapped.paidAmount,
    remainingAmount: mapped.remainingAmount,
    paidAt: mapped.status === "paid" ? input.row.dueDate || input.row.issueDate : null,
    currency: normalizedCurrency(input.row.currency),
    status: mapped.status,
    rawRowJson: smartBillRawJson(input.row, input.companyContext),
    needsReview: mapped.status === "needs_review" || !isSupportedCurrency(input.row.currency),
    includedInReport: !mapped.ignored,
    rowType: "smartbill_supplier_document",
    reviewNote: mapped.status === "needs_review" ? "Status SmartBill necunoscut sau rand incomplet." : null,
    reviewedByUserId: input.reviewedByUserId || null,
    reviewedAt: new Date()
  };
}

export function smartBillCustomerAdjustmentReceivableData(input: {
  row: SmartBillCustomerInvoiceRow;
  uploadId: string;
  companyContext: SmartBillCompanyContext;
  linkedReceivable: SmartBillExistingFinancialRow;
  reviewedByUserId?: string | null;
}) {
  const rawRowJson = {
    ...(smartBillRawJson(input.row, input.companyContext) as Record<string, Prisma.InputJsonValue>),
    smartBillAdjustment: {
    kind: classifySmartBillAdjustment(input.row) || "CREDIT_NOTE",
    linkedReceivableId: input.linkedReceivable.id,
    linkedInvoiceNumber: input.linkedReceivable.invoiceNumber || input.linkedReceivable.normalizedInvoiceNumber || null,
    adjustmentAmount: Math.abs(input.row.totalAmount),
    appliedToRemainingAmount: true
    }
  } satisfies Prisma.InputJsonObject;
  return {
    uploadId: input.uploadId,
    clientId: input.linkedReceivable.clientId || null,
    campaignId: null,
    accountOwnerUserId: null,
    companyName: input.companyContext.companyName,
    companyCode: input.companyContext.companyCode,
    invoiceNumber: input.row.invoiceNumber,
    normalizedInvoiceNumber: input.row.normalizedInvoiceNumber,
    invoiceDate: input.row.issueDate,
    clientName: input.row.clientName,
    dueDate: input.row.dueDate,
    invoicedAmount: input.row.totalAmount,
    collectedAmount: 0,
    remainingAmount: 0,
    collectedAt: input.row.issueDate,
    currency: normalizedCurrency(input.row.currency),
    status: "collected",
    rawRowJson,
    needsReview: false,
    includedInReport: true,
    rowType: "smartbill_customer_adjustment",
    reviewNote: `Ajustare SmartBill aplicata la factura ${input.linkedReceivable.invoiceNumber || input.linkedReceivable.normalizedInvoiceNumber || input.linkedReceivable.id}.`,
    reviewedByUserId: input.reviewedByUserId || null,
    reviewedAt: new Date()
  };
}

export function smartBillDedupeKey(row: SmartBillParsedRow) {
  const entity = row.normalizedFiscalCode || normalizeCompanyName(row.kind === "customer_invoice" ? row.clientName : row.supplierName);
  const number = row.kind === "customer_invoice" ? row.normalizedInvoiceNumber : row.normalizedInvoiceNumber;
  return [
    "smartbill",
    row.kind === "customer_invoice" ? "customer" : "supplier",
    number || "no-number",
    entity || "no-entity",
    dateKey(row.issueDate) || "no-date",
    moneyKey(row.totalAmount)
  ].join(":");
}

export function smartBillRawJson(row: SmartBillParsedRow, companyContext: SmartBillCompanyContext): Prisma.InputJsonObject {
  return {
    source: "SmartBill",
    companyName: companyContext.companyName,
    companyCode: companyContext.companyCode,
    smartBillDedupeKey: row.dedupeKey,
    smartBillReportKind: row.kind,
    rowNumber: row.rowNumber,
    sheetName: row.sheetName,
    fiscalCode: row.fiscalCode,
    normalizedFiscalCode: row.normalizedFiscalCode,
    sourceStatus: row.sourceStatus,
    netAmount: row.netAmount,
    vatAmount: row.vatAmount,
    totalAmount: row.totalAmount,
    raw: JSON.parse(JSON.stringify(row.raw)) as Prisma.InputJsonObject
  };
}

function parseSmartBillRow(input: {
  row: unknown[];
  header: string[];
  columnMap: Record<string, number>;
  rowNumber: number;
  sheetName: string;
  reportType: SmartBillReportType;
}): SmartBillParsedRow | null {
  const raw = rawRow(input.header, input.row);
  if (Object.values(raw).every((value) => !cleanCell(value))) return null;
  return input.reportType === "customer_invoices"
    ? parseCustomerInvoiceRow(input, raw)
    : parseSupplierDocumentRow(input, raw);
}

function parseCustomerInvoiceRow(
  input: { row: unknown[]; columnMap: Record<string, number>; rowNumber: number; sheetName: string },
  raw: Record<string, unknown>
): SmartBillCustomerInvoiceRow {
  const clientName = cell(input.row, input.columnMap.clientName);
  const fiscalCode = cleanCell(cell(input.row, input.columnMap.fiscalCode)) || null;
  const issueDate = normalizeSmartBillDate(cell(input.row, input.columnMap.issueDate));
  const dueDate = normalizeSmartBillDate(cell(input.row, input.columnMap.dueDate));
  const totalAmount = normalizeSmartBillMoney(cell(input.row, input.columnMap.totalAmount));
  const mapped = mapSmartBillCustomerInvoiceStatus(cell(input.row, input.columnMap.status), { totalAmount, dueDate });
  const invoiceNumber = cell(input.row, input.columnMap.invoiceNumber);
  const row: SmartBillCustomerInvoiceRow = {
    kind: "customer_invoice",
    rowNumber: input.rowNumber,
    sheetName: input.sheetName,
    clientName,
    fiscalCode,
    normalizedFiscalCode: normalizeFiscalCode(fiscalCode),
    address: cleanCell(cell(input.row, input.columnMap.address)) || null,
    invoiceNumber,
    normalizedInvoiceNumber: normalizeInvoiceNumber(invoiceNumber),
    issueDate,
    dueDate,
    sourceStatus: cleanCell(cell(input.row, input.columnMap.status)) || null,
    status: mapped.status,
    ignored: mapped.ignored,
    currency: normalizedCurrency(cell(input.row, input.columnMap.currency)),
    netAmount: normalizeSmartBillMoney(cell(input.row, input.columnMap.netAmount)),
    vatAmount: normalizeSmartBillMoney(cell(input.row, input.columnMap.vatAmount)),
    totalAmount,
    notes: cleanCell(cell(input.row, input.columnMap.notes)) || null,
    raw,
    issues: [],
    dedupeKey: ""
  };
  row.issues = validateParsedRow(row);
  row.dedupeKey = smartBillDedupeKey(row);
  return row;
}

function parseSupplierDocumentRow(
  input: { row: unknown[]; columnMap: Record<string, number>; rowNumber: number; sheetName: string },
  raw: Record<string, unknown>
): SmartBillSupplierDocumentRow {
  const supplierName = cell(input.row, input.columnMap.supplierName);
  const fiscalCode = cleanCell(cell(input.row, input.columnMap.fiscalCode)) || null;
  const issueDate = normalizeSmartBillDate(cell(input.row, input.columnMap.issueDate));
  const dueDate = normalizeSmartBillDate(cell(input.row, input.columnMap.dueDate));
  const totalAmount = normalizeSmartBillMoney(cell(input.row, input.columnMap.totalAmount));
  const mapped = mapSmartBillSupplierDocumentStatus(cell(input.row, input.columnMap.status), { totalAmount, dueDate });
  const documentNumber = cell(input.row, input.columnMap.documentNumber);
  const row: SmartBillSupplierDocumentRow = {
    kind: "supplier_document",
    rowNumber: input.rowNumber,
    sheetName: input.sheetName,
    supplierName,
    fiscalCode,
    normalizedFiscalCode: normalizeFiscalCode(fiscalCode),
    documentNumber,
    normalizedInvoiceNumber: normalizeInvoiceNumber(documentNumber),
    issueDate,
    dueDate,
    category: cleanCell(cell(input.row, input.columnMap.category)) || null,
    sourceStatus: cleanCell(cell(input.row, input.columnMap.status)) || null,
    status: mapped.status,
    ignored: mapped.ignored,
    currency: normalizedCurrency(cell(input.row, input.columnMap.currency)),
    netAmount: normalizeSmartBillMoney(cell(input.row, input.columnMap.netAmount)),
    vatAmount: normalizeSmartBillMoney(cell(input.row, input.columnMap.vatAmount)),
    totalAmount,
    notes: cleanCell(cell(input.row, input.columnMap.notes)) || null,
    raw,
    issues: [],
    dedupeKey: ""
  };
  row.issues = validateParsedRow(row);
  row.dedupeKey = smartBillDedupeKey(row);
  return row;
}

function previewRow(row: SmartBillParsedRow, context: SmartBillPreviewContext, companyContext: SmartBillCompanyContext, reportRows: SmartBillParsedRow[] = []): SmartBillPreviewRow {
  const entityKind = row.kind === "customer_invoice" ? "client" : "supplier";
  const entityName = row.kind === "customer_invoice" ? row.clientName : row.supplierName;
  const documentNumber = row.kind === "customer_invoice" ? row.invoiceNumber : row.documentNumber;
  const entities = entityKind === "client" ? context.clients || [] : context.suppliers || [];
  const financialRows = entityKind === "client" ? context.receivables || [] : context.payables || [];
  const match = matchSmartBillEntity(row, entities);
  const duplicate = findSmartBillDuplicate(row, financialRows, companyContext);
  const conflictingDocument = findSmartBillDocumentConflict(row, financialRows, companyContext);
  const errors = [...row.issues];
  const adjustmentKind = classifySmartBillAdjustment(row);
  const adjustmentRows = adjustmentKind ? [...financialRows, ...sameReportAdjustmentCandidates(row, reportRows, companyContext)] : financialRows;
  const adjustmentMatch = adjustmentKind ? findSmartBillAdjustmentMatch(row, adjustmentRows, companyContext) : null;
  const adjustmentCandidates = adjustmentKind && row.kind === "customer_invoice"
    ? findSmartBillAdjustmentCandidates(row, financialRows, companyContext)
    : [];
  let proposedAction: SmartBillPreviewAction = "AUTO_MATCHED";
  let warning: string | null = null;

  if (row.ignored) {
    proposedAction = "IGNORED";
    warning = "Rand ignorat din cauza statusului SmartBill.";
  } else if (errors.length) {
    proposedAction = "INVALID";
  } else if (adjustmentKind && duplicate) {
    proposedAction = "DUPLICATE";
    warning = "Ajustarea SmartBill pare deja introdusa si nu va fi aplicata din nou.";
  } else if (duplicate && !isSmartBillSourceDuplicate(duplicate, row.dedupeKey)) {
    proposedAction = "DUPLICATE";
    warning = "Factura/documentul pare deja introdus si nu va fi duplicat.";
  } else if (adjustmentKind) {
    if (row.kind === "customer_invoice" && adjustmentMatch?.kind === "auto") {
      proposedAction = "AUTO_LINK_ADJUSTMENT";
      warning = adjustmentMatch.reason;
    } else {
      proposedAction = "ADJUSTMENT_NEEDS_REVIEW";
      warning = adjustmentMatch?.reason || "Document negativ SmartBill; necesita legare manuala inainte de aplicare.";
    }
  } else if (row.status === "needs_review") {
    proposedAction = "NEEDS_REVIEW";
    warning = "Status SmartBill necunoscut sau insuficient pentru import automat.";
  } else if (conflictingDocument && !duplicate) {
    proposedAction = "NEEDS_REVIEW";
    warning = "Exista acelasi numar de document si aceeasi data, dar suma difera.";
  } else if (match.kind === "ambiguous") {
    proposedAction = "NEEDS_REVIEW";
    warning = "Exista mai multe potriviri posibile pentru companie.";
  } else if (match.kind === "none") {
    proposedAction = entityKind === "client" ? "PROPOSE_CREATE_CLIENT" : "PROPOSE_CREATE_SUPPLIER";
  }

  return {
    rowNumber: row.rowNumber,
    sheetName: row.sheetName,
    companyName: companyContext.companyName,
    companyCode: companyContext.companyCode,
    kind: row.kind,
    entityKind,
    entityName,
    fiscalCode: row.fiscalCode,
    normalizedFiscalCode: row.normalizedFiscalCode,
    documentNumber,
    issueDate: isoDate(row.issueDate),
    dueDate: isoDate(row.dueDate),
    sourceStatus: row.sourceStatus,
    mappedStatus: row.status,
    currency: row.currency,
    netAmount: row.netAmount,
    vatAmount: row.vatAmount,
    totalAmount: row.totalAmount,
    matchedEntityId: match.entity?.id || null,
    matchedEntityName: match.entity?.name || null,
    duplicateId: duplicate?.id || null,
    adjustmentKind,
    linkedFinancialRowId: adjustmentMatch?.linkedRow?.id || null,
    linkedDocumentNumber: adjustmentMatch?.linkedRow?.invoiceNumber || adjustmentMatch?.linkedRow?.normalizedInvoiceNumber || null,
    matchConfidence: adjustmentMatch?.matchConfidence || null,
    adjustmentReason: adjustmentMatch?.reason || null,
    adjustmentCandidates,
    proposedAction,
    warning,
    errors,
    dedupeKey: row.dedupeKey
  };
}

export function matchSmartBillEntity(row: SmartBillParsedRow, entities: SmartBillMatchEntity[]) {
  const normalizedTaxId = row.normalizedFiscalCode;
  if (normalizedTaxId) {
    const taxMatches = entities.filter((entity) => normalizeFiscalCode(entity.taxId) === normalizedTaxId);
    if (taxMatches.length === 1) return { kind: "matched" as const, entity: taxMatches[0] };
    if (taxMatches.length > 1) return { kind: "ambiguous" as const, matches: taxMatches };
  }
  const name = normalizeCompanyName(row.kind === "customer_invoice" ? row.clientName : row.supplierName);
  if (name) {
    const nameMatches = entities.filter((entity) => (entity.normalizedName || normalizeCompanyName(entity.name)) === name);
    if (nameMatches.length === 1) return { kind: "matched" as const, entity: nameMatches[0] };
    if (nameMatches.length > 1) return { kind: "ambiguous" as const, matches: nameMatches };
  }
  return { kind: "none" as const };
}

export function findSmartBillDuplicate(row: SmartBillParsedRow, existingRows: SmartBillExistingFinancialRow[], companyContext?: SmartBillCompanyContext) {
  return existingRows.find((existing) => {
    if (!sameFinancialCompany(existing, companyContext)) return false;
    if (rawSmartBillDedupeKey(existing.rawRowJson) === row.dedupeKey) return true;
    if (normalizeInvoiceNumber(existing.normalizedInvoiceNumber || existing.invoiceNumber) !== row.normalizedInvoiceNumber) return false;
    if (dateKey(existing.invoiceDate) !== dateKey(row.issueDate)) return false;
    if (Math.abs(existingAmount(existing) - row.totalAmount) > 0.01) return false;
    if (existing.includedInReport === false || ["cancelled", "archived"].includes(String(existing.status || ""))) return false;
    return true;
  }) || null;
}

export function findSmartBillDocumentConflict(row: SmartBillParsedRow, existingRows: SmartBillExistingFinancialRow[], companyContext?: SmartBillCompanyContext) {
  return existingRows.find((existing) => {
    if (!sameFinancialCompany(existing, companyContext)) return false;
    if (normalizeInvoiceNumber(existing.normalizedInvoiceNumber || existing.invoiceNumber) !== row.normalizedInvoiceNumber) return false;
    if (dateKey(existing.invoiceDate) !== dateKey(row.issueDate)) return false;
    if (existing.includedInReport === false || ["cancelled", "archived"].includes(String(existing.status || ""))) return false;
    return Math.abs(existingAmount(existing) - row.totalAmount) > 0.01;
  }) || null;
}

export function isSmartBillSourceDuplicate(existing: SmartBillExistingFinancialRow, dedupeKey: string) {
  return rawSmartBillDedupeKey(existing.rawRowJson) === dedupeKey;
}

export function classifySmartBillAdjustment(row: SmartBillParsedRow): SmartBillAdjustmentKind | null {
  if (!Number.isFinite(row.totalAmount) || row.totalAmount >= 0) return null;
  const text = normalizeText([
    row.kind === "customer_invoice" ? row.invoiceNumber : row.documentNumber,
    row.notes,
    row.sourceStatus,
    JSON.stringify(row.raw || {})
  ].filter(Boolean).join(" "));
  if (/\b(storno|stornare|stornat)\b/.test(text)) return "STORNO";
  if (/\b(discount|discounturi|reducere|reduceri|rabart|rabat)\b/.test(text)) return "DISCOUNT_ADJUSTMENT";
  return "CREDIT_NOTE";
}

export function findSmartBillAdjustmentMatch(
  row: SmartBillParsedRow,
  existingRows: SmartBillExistingFinancialRow[],
  companyContext?: SmartBillCompanyContext
) {
  const adjustmentKind = classifySmartBillAdjustment(row);
  if (!adjustmentKind) return null;
  if (row.kind !== "customer_invoice") {
    return {
      kind: "review" as const,
      adjustmentKind,
      matchConfidence: "low" as const,
      reason: "Document negativ de furnizor; MVP-ul nu il aplica automat pe plati furnizori."
    };
  }

  const adjustmentAmount = Math.abs(row.totalAmount);
  const candidates = existingRows.filter((existing) =>
    sameFinancialCompany(existing, companyContext) &&
    sameSmartBillEntity(row, existing) &&
    normalizedCurrency(existing.currency) === normalizedCurrency(row.currency) &&
    existingAmount(existing) > 0 &&
    existingRemainingAmount(existing) > 0 &&
    existing.includedInReport !== false &&
    !["cancelled", "archived", "lost", "collected", "paid"].includes(String(existing.status || ""))
  );

  if (!candidates.length) {
    return {
      kind: "review" as const,
      adjustmentKind,
      matchConfidence: "low" as const,
      reason: "Nu exista factura pozitiva deschisa pentru acelasi client, firma si moneda."
    };
  }

  const referenced = candidates.filter((candidate) => smartBillAdjustmentReferencesInvoice(row, candidate));
  if (referenced.length > 1) {
    return {
      kind: "review" as const,
      adjustmentKind,
      matchConfidence: "low" as const,
      reason: "Observatiile par sa indice mai multe facturi posibile."
    };
  }

  const linkedRow = referenced[0] || (candidates.length === 1 ? candidates[0] : null);
  if (!linkedRow) {
    return {
      kind: "review" as const,
      adjustmentKind,
      matchConfidence: "low" as const,
      reason: "Exista mai multe facturi deschise si documentul negativ nu indica factura originala."
    };
  }

  const remaining = existingRemainingAmount(linkedRow);
  if (adjustmentAmount > remaining + 0.01) {
    return {
      kind: "review" as const,
      adjustmentKind,
      linkedRow,
      matchConfidence: referenced[0] ? "high" as const : "medium" as const,
      reason: "Valoarea negativa depaseste soldul deschis al facturii gasite; poate necesita impartire."
    };
  }

  return {
    kind: "auto" as const,
    adjustmentKind,
    linkedRow,
    matchConfidence: referenced[0] ? "high" as const : "medium" as const,
    reason: referenced[0]
      ? "Factura originala este mentionata clar in observatiile SmartBill."
      : "Exista exact o singura factura pozitiva deschisa pentru client si moneda."
  };
}

export function findSmartBillAdjustmentCandidates(
  row: SmartBillParsedRow,
  existingRows: SmartBillExistingFinancialRow[],
  companyContext?: SmartBillCompanyContext
): SmartBillAdjustmentCandidate[] {
  const adjustmentKind = classifySmartBillAdjustment(row);
  if (!adjustmentKind || row.kind !== "customer_invoice") return [];
  return existingRows
    .filter((existing) =>
      sameFinancialCompany(existing, companyContext) &&
      sameSmartBillEntity(row, existing) &&
      normalizedCurrency(existing.currency) === normalizedCurrency(row.currency) &&
      existingAmount(existing) > 0 &&
      existingRemainingAmount(existing) > 0 &&
      existing.includedInReport !== false &&
      !["cancelled", "archived", "lost", "collected", "paid"].includes(String(existing.status || ""))
    )
    .slice(0, 25)
    .map((existing) => {
      const referenced = smartBillAdjustmentReferencesInvoice(row, existing);
      return {
        id: existing.id,
        documentNumber: existing.invoiceNumber || existing.normalizedInvoiceNumber || null,
        entityName: existing.clientName || existing.supplierName || null,
        issueDate: isoDate(existing.invoiceDate),
        dueDate: isoDate(existing.dueDate),
        currency: normalizedCurrency(existing.currency),
        totalAmount: existingAmount(existing),
        remainingAmount: existingRemainingAmount(existing),
        matchConfidence: referenced ? "high" : "medium",
        reason: referenced
          ? "Factura pare mentionata in observatiile documentului negativ."
          : "Aceeasi firma, client si moneda; necesita alegere manuala."
      };
    });
}

function sameReportAdjustmentCandidates(row: SmartBillParsedRow, reportRows: SmartBillParsedRow[], companyContext: SmartBillCompanyContext): SmartBillExistingFinancialRow[] {
  if (row.kind !== "customer_invoice") return [];
  return reportRows
    .filter((candidate): candidate is SmartBillCustomerInvoiceRow =>
      candidate.kind === "customer_invoice" &&
      candidate.dedupeKey !== row.dedupeKey &&
      candidate.totalAmount > 0 &&
      !candidate.ignored &&
      !candidate.issues.length &&
      !["collected", "cancelled", "needs_review"].includes(candidate.status)
    )
    .map((candidate) => ({
      id: `preview:${candidate.dedupeKey}`,
      companyName: companyContext.companyName,
      companyCode: companyContext.companyCode,
      normalizedInvoiceNumber: candidate.normalizedInvoiceNumber,
      invoiceNumber: candidate.invoiceNumber,
      invoiceDate: candidate.issueDate,
      dueDate: candidate.dueDate,
      clientName: candidate.clientName,
      entityTaxId: candidate.normalizedFiscalCode,
      entityNormalizedName: normalizeCompanyName(candidate.clientName),
      currency: candidate.currency,
      amount: candidate.totalAmount,
      remainingAmount: candidate.totalAmount,
      paidOrCollectedAmount: 0,
      rawRowJson: { normalizedFiscalCode: candidate.normalizedFiscalCode, smartBillDedupeKey: candidate.dedupeKey },
      includedInReport: true,
      status: candidate.status
    }));
}

export function calculateSmartBillReceivableAdjustment(input: {
  row: SmartBillCustomerInvoiceRow;
  receivable: SmartBillExistingFinancialRow;
  now?: Date;
}) {
  const adjustmentAmount = roundMoney(Math.abs(input.row.totalAmount));
  const currentRemaining = existingRemainingAmount(input.receivable);
  if (adjustmentAmount > currentRemaining + 0.01) {
    throw new Error("Ajustarea SmartBill depaseste soldul facturii legate.");
  }
  const remainingAmount = roundMoney(Math.max(0, currentRemaining - adjustmentAmount));
  return {
    adjustmentAmount,
    remainingAmount,
    originalInvoicedAmount: existingAmount(input.receivable),
    status: financialStatus({
      kind: "receivable",
      remainingAmount,
      paidOrCollected: input.receivable.paidOrCollectedAmount,
      dueDate: parseExistingDate(input.receivable.dueDate),
      now: input.now
    })
  };
}

function summarizePreviewRows(reportType: SmartBillReportType, rows: SmartBillPreviewRow[]): SmartBillPreviewSummary {
  const buckets = {
    AUTO_MATCHED: 0,
    PROPOSE_CREATE_CLIENT: 0,
    PROPOSE_CREATE_SUPPLIER: 0,
    AUTO_LINK_ADJUSTMENT: 0,
    ADJUSTMENT_NEEDS_REVIEW: 0,
    DUPLICATE: 0,
    NEEDS_REVIEW: 0,
    INVALID: 0,
    IGNORED: 0
  } satisfies Record<SmartBillPreviewAction, number>;
  rows.forEach((row) => {
    buckets[row.proposedAction] += 1;
  });
  const importableRows = rows.filter((row) => importableAction(row.proposedAction));
  return {
    reportType,
    rowCount: rows.length,
    matchedCount: buckets.AUTO_MATCHED,
    createClientCount: buckets.PROPOSE_CREATE_CLIENT,
    createSupplierCount: buckets.PROPOSE_CREATE_SUPPLIER,
    duplicateCount: buckets.DUPLICATE,
    needsReviewCount: buckets.NEEDS_REVIEW,
    invalidCount: buckets.INVALID,
    ignoredCount: buckets.IGNORED,
    autoLinkedAdjustmentCount: buckets.AUTO_LINK_ADJUSTMENT,
    adjustmentNeedsReviewCount: buckets.ADJUSTMENT_NEEDS_REVIEW,
    totalReceivable: roundMoney(importableRows.filter((row) => row.kind === "customer_invoice").reduce((sum, row) => sum + row.totalAmount, 0)),
    totalPayable: roundMoney(importableRows.filter((row) => row.kind === "supplier_document").reduce((sum, row) => sum + row.totalAmount, 0)),
    totalReceivableByCurrency: sumByCurrency(importableRows.filter((row) => row.kind === "customer_invoice")),
    totalPayableByCurrency: sumByCurrency(importableRows.filter((row) => row.kind === "supplier_document")),
    buckets
  };
}

export function importableAction(action: SmartBillPreviewAction) {
  return action === "AUTO_MATCHED" || action === "PROPOSE_CREATE_CLIENT" || action === "PROPOSE_CREATE_SUPPLIER" || action === "AUTO_LINK_ADJUSTMENT";
}

function validateParsedRow(row: SmartBillParsedRow) {
  const issues: string[] = [];
  const entityName = row.kind === "customer_invoice" ? row.clientName : row.supplierName;
  const documentNumber = row.kind === "customer_invoice" ? row.invoiceNumber : row.documentNumber;
  if (!entityName) issues.push(row.kind === "customer_invoice" ? "Lipseste clientul." : "Lipseste furnizorul.");
  if (!documentNumber) issues.push("Lipseste numarul documentului.");
  if (!row.issueDate) issues.push("Lipseste data documentului.");
  if (!row.currency || !isSupportedCurrency(row.currency)) issues.push("Moneda trebuie sa fie RON sau EUR.");
  if (!Number.isFinite(row.totalAmount) || row.totalAmount === 0) issues.push("Valoarea totala lipseste sau este zero.");
  return issues;
}

function findHeaderRow(rows: unknown[][], aliases: Record<string, string[]>) {
  const requiredKeys = Object.keys(aliases).filter((key) => !["address", "notes", "category"].includes(key));
  return rows.findIndex((row) => {
    const normalized = row.map((cellValue) => normalizeText(cellValue));
    const score = requiredKeys.filter((key) => aliases[key].some((alias) => normalized.includes(normalizeText(alias)))).length;
    return score >= Math.min(requiredKeys.length, 6);
  });
}

function mapColumns(header: string[], aliases: Record<string, string[]>) {
  const normalizedHeader = header.map((value) => normalizeText(value));
  return Object.fromEntries(Object.entries(aliases).map(([key, names]) => [
    key,
    normalizedHeader.findIndex((headerName) => names.some((alias) => headerName === normalizeText(alias)))
  ]));
}

function rawRow(header: string[], row: unknown[]) {
  return Object.fromEntries(header.map((key, index) => [key || `col_${index + 1}`, row[index] ?? null]));
}

function cell(row: unknown[], index: number | undefined) {
  if (index == null || index < 0) return "";
  return cleanCell(row[index]);
}

function cleanCell(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeText(value: unknown) {
  return cleanCell(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedCurrency(value: unknown) {
  const currency = cleanCell(value).toUpperCase();
  return currency || null;
}

function isSupportedCurrency(value: unknown) {
  const currency = normalizedCurrency(value);
  return currency === "RON" || currency === "EUR";
}

function sumByCurrency(rows: SmartBillPreviewRow[]) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    const currency = row.currency || "FARA_MONEDA";
    totals[currency] = roundMoney((totals[currency] || 0) + row.totalAmount);
    return totals;
  }, {});
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(date: Date | string | null | undefined) {
  const parsed = typeof date === "string" ? new Date(date) : date;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function dateKey(date: Date | string | null | undefined) {
  return isoDate(date) || "";
}

function moneyKey(value: number) {
  return roundMoney(value).toFixed(2);
}

function existingAmount(existing: SmartBillExistingFinancialRow) {
  if (existing.amount && typeof existing.amount === "object" && "toNumber" in existing.amount) {
    return roundMoney((existing.amount as Prisma.Decimal).toNumber());
  }
  const parsed = Number(String(existing.amount ?? 0).replace(",", "."));
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function existingRemainingAmount(existing: SmartBillExistingFinancialRow) {
  if (existing.remainingAmount && typeof existing.remainingAmount === "object" && "toNumber" in existing.remainingAmount) {
    return roundMoney((existing.remainingAmount as Prisma.Decimal).toNumber());
  }
  const parsed = Number(String(existing.remainingAmount ?? existing.amount ?? 0).replace(",", "."));
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function sameSmartBillEntity(row: SmartBillParsedRow, existing: SmartBillExistingFinancialRow) {
  const rowName = row.kind === "customer_invoice" ? row.clientName : row.supplierName;
  if (row.normalizedFiscalCode) {
    return normalizeFiscalCode(existing.entityTaxId) === row.normalizedFiscalCode || normalizeFiscalCode(rawFiscalCode(existing.rawRowJson)) === row.normalizedFiscalCode;
  }
  const existingName = existing.entityNormalizedName || normalizeCompanyName(row.kind === "customer_invoice" ? existing.clientName : existing.supplierName);
  return Boolean(rowName && existingName && existingName === normalizeCompanyName(rowName));
}

function smartBillAdjustmentReferencesInvoice(row: SmartBillParsedRow, existing: SmartBillExistingFinancialRow) {
  const invoiceNumber = normalizeInvoiceNumber(existing.normalizedInvoiceNumber || existing.invoiceNumber);
  if (!invoiceNumber) return false;
  const text = normalizeInvoiceNumber([
    row.kind === "customer_invoice" ? row.invoiceNumber : row.documentNumber,
    row.notes,
    JSON.stringify(row.raw || {})
  ].filter(Boolean).join(" "));
  return text.includes(invoiceNumber);
}

function rawFiscalCode(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).normalizedFiscalCode || (raw as Record<string, unknown>).fiscalCode;
  return typeof value === "string" ? value : null;
}

function parseExistingDate(date: Date | string | null | undefined) {
  const parsed = typeof date === "string" ? new Date(date) : date;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function rawSmartBillDedupeKey(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).smartBillDedupeKey;
  return typeof value === "string" ? value : null;
}

function sameFinancialCompany(existing: SmartBillExistingFinancialRow, companyContext?: SmartBillCompanyContext) {
  if (!companyContext) return true;
  if (!existing.companyCode && !existing.companyName) return true;
  const existingCode = existing.companyCode || companyCodeForEntity(existing.companyName);
  if (existingCode) return existingCode === companyContext.companyCode;
  return existing.companyName === companyContext.companyName;
}

function rehydrateSmartBillRow(row: SmartBillParsedRow): SmartBillParsedRow {
  return {
    ...row,
    issueDate: row.issueDate ? new Date(row.issueDate) : null,
    dueDate: row.dueDate ? new Date(row.dueDate) : null
  } as SmartBillParsedRow;
}

function smartBillFileHash(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function smartBillTokenSecret() {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== "production") return "focus-media-smartbill-local-preview-secret";
  throw new Error("AUTH_SECRET lipseste pentru tokenul de import SmartBill.");
}

function base64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
