import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeClientName } from "@/lib/clients";
import { normalizeReceivableInvoiceNumber, receivableRowHash } from "@/lib/receivables-domain";
import { excelSerialToUtcDate, parseSecureSpreadsheet } from "@/lib/secure-spreadsheet";
import { canonicalTaxId } from "@/lib/tax-id";

export type ReceivablesCompanyCode = "FOCUS_MEDIA" | "EXCELLENCE_MEDIA" | "FOCUS_BG";
export type ReceivablesCurrency = "RON" | "EUR";

export type ReceivablesImportRow = {
  companyName: string;
  companyCode: ReceivablesCompanyCode;
  sheetName: string;
  rowNumber: number;
  sourceRowKey: string;
  sourceHash: string;
  rawInvoiceNumber: string;
  normalizedInvoiceNumber: string;
  invoiceDate: Date | null;
  dueDate: Date | null;
  currency: ReceivablesCurrency | null;
  invoiceAmount: string | null;
  reportCollectedAmount: string | null;
  reportRemainingAmount: string | null;
  locationText: string | null;
  campaignDetails: string | null;
  clientNameRaw: string;
  normalizedClientName: string;
  clientFiscalCodeRaw: string | null;
  normalizedClientFiscalCode: string | null;
  rowState: "valid" | "needs_review" | "credit" | "conflict";
  warnings: string[];
  rawRowJson: Record<string, string | number | boolean | null>;
};

export type ReceivablesImportIssue = {
  companyCode: ReceivablesCompanyCode | null;
  sheetName: string | null;
  rowNumber: number | null;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type ReceivablesParsedWorkbook = {
  fileHash: string;
  reportDate: Date | null;
  rows: ReceivablesImportRow[];
  issues: ReceivablesImportIssue[];
  summaries: Array<{
    companyCode: ReceivablesCompanyCode;
    currency: ReceivablesCurrency;
    invoiceAmount: string;
    collectedAmount: string;
    remainingAmount: string;
    creditAmount: string;
    rowCount: number;
  }>;
  declaredTotals: Array<{
    companyCode: ReceivablesCompanyCode;
    currency: ReceivablesCurrency;
    clientNameRaw: string | null;
    normalizedClientName: string | null;
    invoiceAmount: string | null;
    collectedAmount: string | null;
    remainingAmount: string | null;
    rowNumber: number;
  }>;
};

type HeaderName = "invoiceNumber" | "invoiceDate" | "location" | "campaignDetails" | "clientName" | "clientFiscalCode" | "dueDate" | "currency" | "invoiceAmount" | "collectedAmount" | "remainingAmount";
type HeaderMap = Partial<Record<HeaderName, number>>;

const COMPANY_NAMES: Record<ReceivablesCompanyCode, string> = {
  FOCUS_MEDIA: "Focus Media",
  EXCELLENCE_MEDIA: "Excellence Media",
  FOCUS_BG: "Focus BG / Focus Media LLC EOOD"
};

export async function parseReceivablesWorkbook(input: {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
  signal?: AbortSignal;
  selectedCompanyCode?: ReceivablesCompanyCode | null;
  now?: Date;
}): Promise<ReceivablesParsedWorkbook> {
  const workbook = await parseSecureSpreadsheet({
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    purpose: "receivables",
    allowedExtensions: ["xlsx", "xls"],
    raw: true,
    signal: input.signal
  });
  const fileHash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const rows: ReceivablesImportRow[] = [];
  const issues: ReceivablesImportIssue[] = [];
  const declaredTotals: ReceivablesParsedWorkbook["declaredTotals"] = [];
  let reportDate = parseDateFromText(input.fileName);

  for (const sheet of workbook.sheets) {
    const sheetName = sheet.name;
    const grid = sheet.rows;
    const title = grid.slice(0, 5).flat().map(cleanText).filter(Boolean).join(" ");
    reportDate ||= parseDateFromText(title);
    const detected = detectReceivablesCompany(`${sheetName} ${title}`);
    const companyCode = input.selectedCompanyCode || detected;

    if (!companyCode) {
      issues.push(importIssue(null, sheetName, null, "unknown_company", "critical", "Firma emitentă nu a putut fi identificată din foaie."));
      continue;
    }
    if (input.selectedCompanyCode && detected && input.selectedCompanyCode !== detected) {
      continue;
    }

    const table = findReceivablesTable(grid);
    if (!table) {
      issues.push(importIssue(companyCode, sheetName, null, "missing_receivables_section", "critical", "Nu am găsit secțiunea «LISTA ÎNCASĂRI» și anteturile obligatorii."));
      continue;
    }

    for (let index = table.headerRow + 1; index < grid.length; index += 1) {
      const source = sourceObject(grid[index] || [], table.headers);
      if (!Object.values(source).some(hasValue)) continue;
      const rowNumber = index + 1;
      const identity = [source.invoiceNumber, source.clientName, source.location, source.campaignDetails].map(cleanText).filter(Boolean).join(" ");
      const numeric = [source.invoiceAmount, source.collectedAmount, source.remainingAmount].some(hasValue);
      const normalizedIdentity = normalizeText(identity);

      if (isDeclaredTotal(normalizedIdentity, identity, numeric)) {
        const currency = detectCurrency(source, companyCode);
        if (currency) {
          declaredTotals.push({
            companyCode,
            currency,
            clientNameRaw: declaredTotalClient(source),
            normalizedClientName: declaredTotalClient(source) ? normalizeClientName(declaredTotalClient(source)!) : null,
            invoiceAmount: parseMoneyString(source.invoiceAmount),
            collectedAmount: parseMoneyString(source.collectedAmount),
            remainingAmount: parseMoneyString(source.remainingAmount),
            rowNumber
          });
        }
        continue;
      }
      if (!identity && numeric) continue;
      if (!cleanText(source.invoiceNumber) && !cleanText(source.clientName)) continue;

      const parsed = parseReceivablesRow({ source, companyCode, sheetName, rowNumber, reportDate });
      rows.push(parsed.row);
      issues.push(...parsed.issues);
    }
  }

  const summaries = buildSummaries(rows);
  for (const declared of declaredTotals) {
    const selectedRows = rows.filter((row) =>
      row.companyCode === declared.companyCode &&
      row.currency === declared.currency &&
      row.rowState !== "conflict" &&
      (!declared.normalizedClientName || row.normalizedClientName === declared.normalizedClientName)
    );
    if (!selectedRows.length) continue;
    const calculated = {
      invoiceAmount: decimalSum(selectedRows.map((row) => row.invoiceAmount)).toFixed(2),
      collectedAmount: decimalSum(selectedRows.map((row) => row.reportCollectedAmount)).toFixed(2),
      remainingAmount: decimalSum(selectedRows.map((row) => row.reportRemainingAmount)).toFixed(2)
    };
    for (const [field, declaredValue, calculatedValue] of [
      ["facturat", declared.invoiceAmount, calculated.invoiceAmount],
      ["încasat", declared.collectedAmount, calculated.collectedAmount],
      ["rest", declared.remainingAmount, calculated.remainingAmount]
    ] as const) {
      if (declaredValue != null && !moneyEqual(declaredValue, calculatedValue)) {
        const scope = declared.clientNameRaw ? ` pentru clientul ${declared.clientNameRaw}` : "";
        issues.push(importIssue(declared.companyCode, null, declared.rowNumber, "declared_total_mismatch", "critical", `Totalul declarat ${field}${scope} (${declaredValue}) nu corespunde sumei rândurilor (${calculatedValue}).`));
      }
    }
  }

  return { fileHash, reportDate, rows, issues, summaries, declaredTotals };
}

function parseReceivablesRow(input: {
  source: Record<HeaderName, unknown>;
  companyCode: ReceivablesCompanyCode;
  sheetName: string;
  rowNumber: number;
  reportDate: Date | null;
}) {
  const { source, companyCode, sheetName, rowNumber, reportDate } = input;
  const warnings: string[] = [];
  const issues: ReceivablesImportIssue[] = [];
  const rawInvoiceNumber = cleanText(source.invoiceNumber);
  const clientNameRaw = cleanText(source.clientName);
  const clientFiscalCodeRaw = cleanText(source.clientFiscalCode) || null;
  const normalizedClientFiscalCode = canonicalTaxId(clientFiscalCodeRaw) || null;
  const invoiceAmount = parseMoneyString(source.invoiceAmount);
  const collectedAmount = parseMoneyString(source.collectedAmount) || "0.00";
  const remainingAmount = parseMoneyString(source.remainingAmount);
  const dueDate = parseExcelDate(source.dueDate);
  const invoiceDate = parseExcelDate(source.invoiceDate) || inferInvoiceDate(rawInvoiceNumber, reportDate);
  const currency = detectCurrency(source, companyCode);

  if (!rawInvoiceNumber) warnings.push("Lipsește numărul facturii.");
  if (!clientNameRaw) warnings.push("Lipsește clientul.");
  if (!dueDate) warnings.push("Lipsește sau este invalidă data scadenței.");
  if (!currency) warnings.push("Moneda nu poate fi determinată.");
  if (invoiceAmount == null) warnings.push("Suma facturată nu poate fi citită.");
  if (remainingAmount == null) warnings.push("Restul de încasat nu poate fi citit.");

  let rowState: ReceivablesImportRow["rowState"] = warnings.length ? "needs_review" : "valid";
  if (invoiceAmount != null && remainingAmount != null) {
    const expected = decimal(invoiceAmount).minus(decimal(collectedAmount));
    if (expected.minus(decimal(remainingAmount)).abs().greaterThan("0.01")) {
      rowState = "conflict";
      const message = `Neconcordanță: facturat - încasat = ${expected.toFixed(2)}, dar raportul declară ${remainingAmount}.`;
      warnings.push(message);
      issues.push(importIssue(companyCode, sheetName, rowNumber, "row_amount_mismatch", "critical", message));
    } else if (expected.isNegative() || decimal(collectedAmount).greaterThan(decimal(invoiceAmount))) {
      rowState = "credit";
      warnings.push(`Supraplată / credit client: ${expected.abs().toFixed(2)} ${currency || ""}.`.trim());
    }
  }
  for (const warning of warnings) {
    if (!issues.some((issue) => issue.message === warning)) {
      issues.push(importIssue(companyCode, sheetName, rowNumber, "row_warning", rowState === "conflict" ? "critical" : "warning", warning));
    }
  }

  const normalizedInvoiceNumber = normalizeReceivableInvoiceNumber(rawInvoiceNumber);
  const normalizedClientName = normalizeClientName(clientNameRaw);
  const sourceHash = receivableRowHash({
    companyCode,
    normalizedInvoiceNumber,
    currency,
    normalizedClientName,
    normalizedClientFiscalCode,
    invoiceAmount,
    collectedAmount,
    remainingAmount,
    dueDate
  });

  const row: ReceivablesImportRow = {
    companyName: COMPANY_NAMES[companyCode],
    companyCode,
    sheetName,
    rowNumber,
    sourceRowKey: `${normalizeText(sheetName) || "sheet"}:${rowNumber}`,
    sourceHash,
    rawInvoiceNumber,
    normalizedInvoiceNumber,
    invoiceDate,
    dueDate,
    currency,
    invoiceAmount,
    reportCollectedAmount: collectedAmount,
    reportRemainingAmount: remainingAmount,
    locationText: cleanText(source.location) || null,
    campaignDetails: cleanText(source.campaignDetails) || null,
    clientNameRaw,
    normalizedClientName,
    clientFiscalCodeRaw,
    normalizedClientFiscalCode,
    rowState,
    warnings,
    rawRowJson: Object.fromEntries(Object.entries(source).map(([key, value]) => [key, jsonValue(value)]))
  };
  return { row, issues };
}

function findReceivablesTable(rows: unknown[][]) {
  for (let markerRow = 0; markerRow < Math.min(rows.length, 50); markerRow += 1) {
    const markerColumn = (rows[markerRow] || []).findIndex((cell) => normalizeText(cell).includes("lista incasari"));
    if (markerColumn < 0) continue;
    for (let headerRow = markerRow + 1; headerRow < Math.min(rows.length, markerRow + 10); headerRow += 1) {
      const headers = headerMap(rows[headerRow] || [], markerColumn);
      if (hasRequiredHeaders(headers)) return { markerRow, markerColumn, headerRow, headers };
    }
  }
  return null;
}

function headerMap(row: unknown[], startColumn: number): HeaderMap {
  const result: HeaderMap = {};
  for (let column = startColumn; column < Math.min(row.length, startColumn + 20); column += 1) {
    const name = headerName(row[column]);
    if (name && result[name] == null) result[name] = column;
  }
  return result;
}

function headerName(value: unknown): HeaderName | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes("data factura") || text.includes("data emiter")) return "invoiceDate";
  if (text.includes("data scadent")) return "dueDate";
  if (text.includes("rest") && text.includes("incas")) return "remainingAmount";
  if (text === "incasat" || text.includes("suma incasata") || text.includes("total incasat")) return "collectedAmount";
  if (text.includes("suma facturat") || text.includes("valoare factura") || text.includes("total factura")) return "invoiceAmount";
  if (text.includes("nr factura") || text === "factura" || text.includes("numar factura")) return "invoiceNumber";
  if (text.includes("detalii campanie") || text.includes("campanie")) return "campaignDetails";
  if (text.includes("locatie")) return "location";
  if (["cui", "cif", "cod fiscal", "cod fiscal client", "vat", "vat id"].includes(text)) return "clientFiscalCode";
  if (text === "client" || text.includes("denumire client")) return "clientName";
  if (text === "moneda" || text === "currency") return "currency";
  return null;
}

function hasRequiredHeaders(map: HeaderMap) {
  return ["invoiceNumber", "clientName", "invoiceAmount", "collectedAmount", "remainingAmount"].every((key) => typeof map[key as HeaderName] === "number");
}

function sourceObject(row: unknown[], map: HeaderMap) {
  const source = {} as Record<HeaderName, unknown>;
  for (const [name, column] of Object.entries(map) as Array<[HeaderName, number]>) source[name] = row[column];
  return source;
}

function buildSummaries(rows: ReceivablesImportRow[]): ReceivablesParsedWorkbook["summaries"] {
  const keys = Array.from(new Set(rows.filter((row) => row.currency).map((row) => `${row.companyCode}:${row.currency}`)));
  return keys.map((key) => {
    const [companyCode, currency] = key.split(":") as [ReceivablesCompanyCode, ReceivablesCurrency];
    const selected = rows.filter((row) => row.companyCode === companyCode && row.currency === currency && row.rowState !== "conflict");
    const invoiceAmount = decimalSum(selected.map((row) => row.invoiceAmount));
    const collectedAmount = decimalSum(selected.map((row) => row.reportCollectedAmount));
    const signedRemaining = decimalSum(selected.map((row) => row.reportRemainingAmount));
    const creditAmount = selected.reduce((sum, row) => {
      if (row.invoiceAmount == null || row.reportCollectedAmount == null) return sum;
      return sum.plus(Prisma.Decimal.max(decimal(row.reportCollectedAmount).minus(decimal(row.invoiceAmount)), 0));
    }, decimal(0));
    return {
      companyCode,
      currency,
      invoiceAmount: invoiceAmount.toFixed(2),
      collectedAmount: collectedAmount.toFixed(2),
      remainingAmount: Prisma.Decimal.max(signedRemaining, 0).toFixed(2),
      creditAmount: creditAmount.toFixed(2),
      rowCount: selected.length
    };
  });
}

export function parseMoneyString(value: unknown): string | null {
  if (!hasValue(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? new Prisma.Decimal(value.toString()).toDecimalPlaces(2).toFixed(2) : null;
  if (value instanceof Date) return null;
  let text = cleanText(value);
  if (!text || /^[-–—]+$/.test(text)) return "0.00";
  const negative = (text.includes("(") && text.includes(")")) || text.trim().startsWith("-");
  text = text.replace(/ron|eur|lei|euro/gi, "").replace(/[()\s\u00a0]/g, "").replace(/[^0-9,.-]/g, "");
  if (!/[0-9]/.test(text)) return text.includes("-") ? "0.00" : null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  try {
    const amount = new Prisma.Decimal(text.replace(/-/g, ""));
    return (negative ? amount.negated() : amount).toDecimalPlaces(2).toFixed(2);
  } catch {
    return null;
  }
}

export function detectReceivablesCompany(value: string): ReceivablesCompanyCode | null {
  const text = normalizeText(value);
  if (text.includes("excellence")) return "EXCELLENCE_MEDIA";
  if (text.includes("eood") || text.includes("focus bg") || text.includes("focus media llc")) return "FOCUS_BG";
  if (text.includes("focus")) return "FOCUS_MEDIA";
  return null;
}

function detectCurrency(source: Record<HeaderName, unknown>, companyCode: ReceivablesCompanyCode): ReceivablesCurrency | null {
  const values = [source.currency, source.invoiceAmount, source.collectedAmount, source.remainingAmount].map((value) => normalizeText(value));
  const hasEur = values.some((value) => /\b(eur|euro)\b/.test(value));
  const hasRon = values.some((value) => /\b(ron|lei|leu)\b/.test(value));
  if (hasEur && hasRon) return null;
  if (hasEur) return "EUR";
  if (hasRon) return "RON";
  return companyCode === "FOCUS_BG" ? "EUR" : "RON";
}

function inferInvoiceDate(invoiceNumber: string, reportDate: Date | null) {
  if (!reportDate) return null;
  const match = invoiceNumber.match(/(?:\/|\s)(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?\s*$/);
  if (!match) return null;
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : reportDate.getUTCFullYear();
  return validUtcDate(year, Number(match[2]), Number(match[1]));
}

function parseExcelDate(value: unknown) {
  if (!hasValue(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfUtcDay(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToUtcDate(value);
  }
  const text = cleanText(value);
  const romanian = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (romanian) return validUtcDate(Number(romanian[3].length === 2 ? `20${romanian[3]}` : romanian[3]), Number(romanian[2]), Number(romanian[1]));
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

function parseDateFromText(value: string) {
  const match = value.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return match ? validUtcDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function validUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isDeclaredTotal(normalizedIdentity: string, identity: string, hasNumeric: boolean) {
  return hasNumeric && Boolean(identity) && /\b(total|subtotal)\b/.test(normalizedIdentity);
}

function declaredTotalClient(source: Record<HeaderName, unknown>) {
  const client = cleanText(source.clientName);
  if (client && !/\b(total|subtotal)\b/.test(normalizeText(client))) return client;
  return null;
}

function importIssue(companyCode: ReceivablesCompanyCode | null, sheetName: string | null, rowNumber: number | null, type: string, severity: ReceivablesImportIssue["severity"], message: string): ReceivablesImportIssue {
  return { companyCode, sheetName, rowNumber, type, severity, message };
}

function decimal(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value);
}

function decimalSum(values: Array<string | null>) {
  return values.reduce<Prisma.Decimal>((sum, value) => value == null ? sum : sum.plus(decimal(value)), decimal(0));
}

function moneyEqual(left: string, right: string) {
  return decimal(left).minus(decimal(right)).abs().lessThanOrEqualTo("0.01");
}

function normalizeText(value: unknown) {
  return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, " ").trim();
}

function hasValue(value: unknown) {
  return value != null && (typeof value !== "number" || Number.isFinite(value)) && cleanText(value) !== "";
}

function jsonValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return cleanText(value);
}
