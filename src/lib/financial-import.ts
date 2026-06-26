import crypto from "crypto";
import * as XLSX from "xlsx";

export type FinancialCompanySnapshotInput = {
  companyName: string;
  companyCode: string;
  totalPayable: number;
  totalPaid: number;
  remainingPayable: number;
  totalReceivable: number;
  totalCollected: number;
  remainingReceivable: number;
  totalPayableRon: number;
  totalPayableEur: number;
  totalPaidRon: number;
  totalPaidEur: number;
  remainingPayableRon: number;
  remainingPayableEur: number;
  totalReceivableRon: number;
  totalReceivableEur: number;
  totalCollectedRon: number;
  totalCollectedEur: number;
  remainingReceivableRon: number;
  remainingReceivableEur: number;
  payableRows: number;
  receivableRows: number;
  issueCount: number;
};

export type FinancialPayableInput = {
  companyName: string;
  companyCode: string;
  supplierName: string | null;
  documentDescription: string | null;
  dueDate: Date | null;
  amountToPay: number | null;
  amountPaid: number | null;
  remainingAmount: number | null;
  currency: Currency | null;
  status: string;
  rawRowJson: FinancialRawJson;
  needsReview: boolean;
  includedInReport: boolean;
  rowType: string;
  reviewNote: string | null;
};

export type FinancialReceivableInput = {
  companyName: string;
  companyCode: string;
  invoiceNumber: string | null;
  location: string | null;
  campaignDetails: string | null;
  clientName: string | null;
  dueDate: Date | null;
  invoicedAmount: number | null;
  collectedAmount: number | null;
  remainingAmount: number | null;
  currency: Currency | null;
  status: string;
  rawRowJson: FinancialRawJson;
  needsReview: boolean;
  includedInReport: boolean;
  rowType: string;
  reviewNote: string | null;
};

export type FinancialIssueInput = {
  companyName: string | null;
  companyCode: string | null;
  sheetName: string | null;
  rowNumber: number | null;
  issueType: string;
  issueMessage: string;
  severity: "info" | "warning" | "critical";
  rawRowJson: FinancialRawJson | null;
};

export type FinancialRawJson = Record<string, string | number | boolean | null>;
export type Currency = "RON" | "EUR";

export type FinancialParsedWorkbook = {
  fileHash: string;
  reportDate: Date | null;
  companies: FinancialCompanySnapshotInput[];
  payables: FinancialPayableInput[];
  receivables: FinancialReceivableInput[];
  issues: FinancialIssueInput[];
  summary: {
    companyCount: number;
    payableRows: number;
    receivableRows: number;
    issueCount: number;
    criticalIssueCount: number;
    needsReviewCount: number;
    ignoredRows: number;
    totalPayable: number;
    totalPaid: number;
    remainingPayable: number;
    totalReceivable: number;
    totalCollected: number;
    remainingReceivable: number;
    totalPayableRon: number;
    totalPayableEur: number;
    totalPaidRon: number;
    totalPaidEur: number;
    remainingPayableRon: number;
    remainingPayableEur: number;
    totalReceivableRon: number;
    totalReceivableEur: number;
    totalCollectedRon: number;
    totalCollectedEur: number;
    remainingReceivableRon: number;
    remainingReceivableEur: number;
  };
};

type HeaderMap = Record<string, number>;

const auxiliaryMarkers = [
  "total",
  "garantie",
  "garantii",
  "imprumut",
  "sold",
  "banca",
  "casa",
  "restituit",
  "esalon",
  "penalitati"
];

export function parseFinancialWorkbook(input: {
  buffer: Buffer;
  fileName: string;
  now?: Date;
  soonDays?: number;
}): FinancialParsedWorkbook {
  const now = startOfUtcDay(input.now || new Date());
  const soonDays = input.soonDays ?? 7;
  const workbook = XLSX.read(input.buffer, { type: "buffer", cellDates: true });
  const fileHash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const payables: FinancialPayableInput[] = [];
  const receivables: FinancialReceivableInput[] = [];
  const issues: FinancialIssueInput[] = [];
  let ignoredRows = 0;
  let reportDate = parseDateFromText(input.fileName);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false, raw: true });
    const title = rows.slice(0, 3).flat().map(cleanText).filter(Boolean).join(" ");
    reportDate ||= parseDateFromText(title);
    const company = detectCompany(sheetName, title);

    if (!company) {
      issues.push(issue(null, null, sheetName, null, "unknown_company", "Sheet-ul nu a putut fi mapat la o firma.", "critical", null));
      continue;
    }

    const headers = detectHeaders(rows);
    if (!headers) {
      issues.push(issue(company.name, company.code, sheetName, null, "missing_headers", "Nu am gasit tabelele de plati/incasari dupa headere.", "critical", null));
      continue;
    }

    for (let index = headers.rowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const payable = parsePayable(row, headers.payable, company, sheetName, index + 1, now, soonDays);
      const receivable = parseReceivable(row, headers.receivable, company, sheetName, index + 1, now, soonDays);
      if (payable.row) payables.push(payable.row);
      if (receivable.row) receivables.push(receivable.row);
      issues.push(...payable.issues, ...receivable.issues);
      ignoredRows += payable.ignored + receivable.ignored;
    }
  }

  const companyCodes = [...new Set([...payables, ...receivables].map((row) => row.companyCode))];
  const companies = companyCodes.map((companyCode) => {
    const companyName = [...payables, ...receivables].find((row) => row.companyCode === companyCode)?.companyName || companyCode;
    const companyPayables = payables.filter((row) => row.companyCode === companyCode && !row.needsReview && row.includedInReport);
    const companyReceivables = receivables.filter((row) => row.companyCode === companyCode && !row.needsReview && row.includedInReport);
    const companyIssues = issues.filter((row) => row.companyCode === companyCode && row.severity !== "info");
    return {
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
      issueCount: companyIssues.length
    };
  });

  return {
    fileHash,
    reportDate,
    companies,
    payables,
    receivables,
    issues,
    summary: {
      companyCount: companies.length,
      payableRows: payables.length,
      receivableRows: receivables.length,
      issueCount: issues.length,
      criticalIssueCount: issues.filter((row) => row.severity === "critical").length,
      needsReviewCount: payables.filter((row) => row.needsReview).length + receivables.filter((row) => row.needsReview).length,
      ignoredRows,
      totalPayable: sum(payables.filter((row) => !row.needsReview && row.includedInReport), "amountToPay"),
      totalPaid: sum(payables.filter((row) => !row.needsReview && row.includedInReport), "amountPaid"),
      remainingPayable: sum(payables.filter((row) => !row.needsReview && row.includedInReport), "remainingAmount"),
      totalReceivable: sum(receivables.filter((row) => !row.needsReview && row.includedInReport), "invoicedAmount"),
      totalCollected: sum(receivables.filter((row) => !row.needsReview && row.includedInReport), "collectedAmount"),
      remainingReceivable: sum(receivables.filter((row) => !row.needsReview && row.includedInReport), "remainingAmount"),
      totalPayableRon: sumCurrency(payables, "amountToPay", "RON"),
      totalPayableEur: sumCurrency(payables, "amountToPay", "EUR"),
      totalPaidRon: sumCurrency(payables, "amountPaid", "RON"),
      totalPaidEur: sumCurrency(payables, "amountPaid", "EUR"),
      remainingPayableRon: sumCurrency(payables, "remainingAmount", "RON"),
      remainingPayableEur: sumCurrency(payables, "remainingAmount", "EUR"),
      totalReceivableRon: sumCurrency(receivables, "invoicedAmount", "RON"),
      totalReceivableEur: sumCurrency(receivables, "invoicedAmount", "EUR"),
      totalCollectedRon: sumCurrency(receivables, "collectedAmount", "RON"),
      totalCollectedEur: sumCurrency(receivables, "collectedAmount", "EUR"),
      remainingReceivableRon: sumCurrency(receivables, "remainingAmount", "RON"),
      remainingReceivableEur: sumCurrency(receivables, "remainingAmount", "EUR")
    }
  };
}

function detectHeaders(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 35); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const normalized = row.map(normalizeText);
    const receivableCols = normalized
      .map((value, index) => ({ value, index, kind: receivableHeaderKind(value) }))
      .filter((item) => item.kind && !["number", "dueDate"].includes(item.kind));
    const receivableStart = receivableCols.length ? Math.min(...receivableCols.map((item) => item.index)) : -1;
    if (receivableStart < 0) continue;
    const rightStart = normalized[receivableStart - 1] === "nr" ? receivableStart - 1 : receivableStart;

    const payable: HeaderMap = {};
    const receivable: HeaderMap = {};
    normalized.forEach((value, columnIndex) => {
      if (!value) return;
      if (columnIndex < rightStart) {
        const kind = payableHeaderKind(value);
        if (kind && payable[kind] == null) payable[kind] = columnIndex;
      } else {
        const kind = receivableHeaderKind(value);
        if (kind && receivable[kind] == null) receivable[kind] = columnIndex;
      }
    });

    if (hasHeaders(payable, ["supplierName", "dueDate", "amountToPay", "amountPaid", "remainingAmount"]) &&
      hasHeaders(receivable, ["invoiceNumber", "clientName", "dueDate", "invoicedAmount", "collectedAmount", "remainingAmount"])) {
      return { rowIndex, payable, receivable };
    }
  }
  return null;
}

function parsePayable(
  row: unknown[],
  map: HeaderMap,
  company: { name: string; code: string },
  sheetName: string,
  rowNumber: number,
  now: Date,
  soonDays: number
) {
  const raw = rawFromMap(row, map);
  if (!hasAnyValue(raw)) return { row: null, issues: [] as FinancialIssueInput[], ignored: 0 };
  const sideText = Object.values(raw).map(cleanText).join(" ");
  const hasTextIdentity = Boolean(cleanText(raw.supplierName) || cleanText(raw.documentDescription));
  const hasOnlyNumericSummary = !hasTextIdentity && [raw.amountToPay, raw.amountPaid, raw.remainingAmount].some(hasValue);
  if (hasOnlyNumericSummary) {
    return {
      row: null,
      issues: [issue(company.name, company.code, sheetName, rowNumber, "numeric_summary_ignored", "Rand numeric auxiliar ignorat la lista de plati.", "info", raw)],
      ignored: 1
    };
  }
  if (looksAuxiliary(sideText)) {
    return {
      row: null,
      issues: [issue(company.name, company.code, sheetName, rowNumber, "auxiliary_row_ignored", "Rand auxiliar/total ignorat la lista de plati.", "info", raw)],
      ignored: 1
    };
  }

  const amountToPay = parseMoney(raw.amountToPay);
  const amountPaid = parseMoney(raw.amountPaid);
  let remainingAmount = parseMoney(raw.remainingAmount);
  if (remainingAmount == null && amountToPay != null) remainingAmount = roundMoney(amountToPay - (amountPaid || 0));
  const currency = detectCurrency([raw.amountToPay, raw.amountPaid, raw.remainingAmount], company);
  const dueDate = parseDate(raw.dueDate);
  const reviewNotes: string[] = [];
  const rowIssues: FinancialIssueInput[] = [];

  if (!cleanText(raw.supplierName)) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_supplier", "Lipseste furnizorul.", raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "amountToPay", raw.amountToPay, amountToPay, raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "amountPaid", raw.amountPaid, amountPaid, raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "remainingAmount", raw.remainingAmount, remainingAmount, raw);
  if (hasValue(raw.dueDate) && !dueDate) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "invalid_due_date", "Data scadenta nu poate fi citita.", raw);
  if (!dueDate && (remainingAmount || 0) > 0) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_due_date", "Lipseste data scadenta pentru un rest de plata.", raw);
  if ((remainingAmount || 0) < 0) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "negative_remaining", "Restul de plata este negativ.", raw);
  if (!currency && [amountToPay, amountPaid, remainingAmount].some((value) => value != null)) {
    review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_currency", "Moneda randului nu poate fi determinata.", raw);
  }

  return {
    row: {
      companyName: company.name,
      companyCode: company.code,
      supplierName: cleanText(raw.supplierName) || null,
      documentDescription: cleanText(raw.documentDescription) || null,
      dueDate,
      amountToPay,
      amountPaid,
      remainingAmount,
      currency,
      status: reviewNotes.length ? "needs_review" : payableStatus(remainingAmount, amountPaid, dueDate, now, soonDays),
      rawRowJson: { ...raw, rowNumber, sheetName, currencySource: currency ? currencySource([raw.amountToPay, raw.amountPaid, raw.remainingAmount], company) : "missing" },
      needsReview: reviewNotes.length > 0,
      includedInReport: true,
      rowType: "payable",
      reviewNote: reviewNotes.join(" ")
    },
    issues: rowIssues,
    ignored: 0
  };
}

function parseReceivable(
  row: unknown[],
  map: HeaderMap,
  company: { name: string; code: string },
  sheetName: string,
  rowNumber: number,
  now: Date,
  soonDays: number
) {
  const raw = rawFromMap(row, map);
  if (!hasAnyValue(raw)) return { row: null, issues: [] as FinancialIssueInput[], ignored: 0 };
  const sideText = Object.values(raw).map(cleanText).join(" ");
  const hasTextIdentity = Boolean(cleanText(raw.invoiceNumber) || cleanText(raw.location) || cleanText(raw.campaignDetails) || cleanText(raw.clientName));
  const hasOnlyNumericSummary = !hasTextIdentity && [raw.invoicedAmount, raw.collectedAmount, raw.remainingAmount].some(hasValue);
  if (hasOnlyNumericSummary) {
    return {
      row: null,
      issues: [issue(company.name, company.code, sheetName, rowNumber, "numeric_summary_ignored", "Rand numeric auxiliar ignorat la lista de incasari.", "info", raw)],
      ignored: 1
    };
  }
  if (looksAuxiliary(sideText)) {
    return {
      row: null,
      issues: [issue(company.name, company.code, sheetName, rowNumber, "auxiliary_row_ignored", "Rand auxiliar/total ignorat la lista de incasari.", "info", raw)],
      ignored: 1
    };
  }

  const invoicedAmount = parseMoney(raw.invoicedAmount);
  const collectedAmount = parseMoney(raw.collectedAmount);
  let remainingAmount = parseMoney(raw.remainingAmount);
  if (remainingAmount == null && invoicedAmount != null) remainingAmount = roundMoney(invoicedAmount - (collectedAmount || 0));
  const currency = detectCurrency([raw.invoicedAmount, raw.collectedAmount, raw.remainingAmount], company);
  const dueDate = parseDate(raw.dueDate);
  const reviewNotes: string[] = [];
  const rowIssues: FinancialIssueInput[] = [];

  if (!cleanText(raw.clientName)) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_client", "Lipseste clientul.", raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "invoicedAmount", raw.invoicedAmount, invoicedAmount, raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "collectedAmount", raw.collectedAmount, collectedAmount, raw);
  addMoneyIssue(rowIssues, reviewNotes, company, sheetName, rowNumber, "remainingAmount", raw.remainingAmount, remainingAmount, raw);
  if (hasValue(raw.dueDate) && !dueDate) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "invalid_due_date", "Data scadenta nu poate fi citita.", raw);
  if (!dueDate && (remainingAmount || 0) > 0) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_due_date", "Lipseste data scadenta pentru un rest de incasat.", raw);
  if ((remainingAmount || 0) < 0) review(rowIssues, reviewNotes, company, sheetName, rowNumber, "negative_remaining", "Restul de incasat este negativ.", raw);
  if (!currency && [invoicedAmount, collectedAmount, remainingAmount].some((value) => value != null)) {
    review(rowIssues, reviewNotes, company, sheetName, rowNumber, "missing_currency", "Moneda randului nu poate fi determinata.", raw);
  }

  return {
    row: {
      companyName: company.name,
      companyCode: company.code,
      invoiceNumber: cleanText(raw.invoiceNumber) || null,
      location: cleanText(raw.location) || null,
      campaignDetails: cleanText(raw.campaignDetails) || null,
      clientName: cleanText(raw.clientName) || null,
      dueDate,
      invoicedAmount,
      collectedAmount,
      remainingAmount,
      currency,
      status: reviewNotes.length ? "needs_review" : receivableStatus(remainingAmount, collectedAmount, dueDate, now, soonDays),
      rawRowJson: { ...raw, rowNumber, sheetName, currencySource: currency ? currencySource([raw.invoicedAmount, raw.collectedAmount, raw.remainingAmount], company) : "missing" },
      needsReview: reviewNotes.length > 0,
      includedInReport: true,
      rowType: "receivable",
      reviewNote: reviewNotes.join(" ")
    },
    issues: rowIssues,
    ignored: 0
  };
}

function payableHeaderKind(value: string) {
  if (value === "nr" || value === "nr crt") return "number";
  if (value.includes("furnizor")) return "supplierName";
  if (value.includes("descriere") || value.includes("doc")) return "documentDescription";
  if (value.includes("data scadenta")) return "dueDate";
  if (value.includes("suma de plata")) return "amountToPay";
  if (value === "achitat") return "amountPaid";
  if (value.includes("rest de plata")) return "remainingAmount";
  return null;
}

function receivableHeaderKind(value: string) {
  if (value === "nr" || value === "nr crt") return "number";
  if (value.includes("suma facturata")) return "invoicedAmount";
  if (value.includes("factura")) return "invoiceNumber";
  if (value.includes("locatie")) return "location";
  if (value.includes("detalii campanie")) return "campaignDetails";
  if (value === "client" || value.includes("client")) return "clientName";
  if (value.includes("data scadenta")) return "dueDate";
  if (value === "incasat") return "collectedAmount";
  if (value.includes("rest de incasat")) return "remainingAmount";
  return null;
}

function hasHeaders(map: HeaderMap, keys: string[]) {
  return keys.every((key) => typeof map[key] === "number");
}

function rawFromMap(row: unknown[], map: HeaderMap) {
  const raw: FinancialRawJson = {};
  for (const [key, columnIndex] of Object.entries(map)) {
    if (key === "number") continue;
    raw[key] = jsonCell(row[columnIndex]);
  }
  return raw;
}

function detectCompany(sheetName: string, title: string) {
  const text = normalizeText(`${sheetName} ${title}`);
  if (text.includes("excellence")) return { name: "Excellence Media", code: "EXCELLENCE_MEDIA" };
  if (text.includes("eood") || text.includes("llc") || text.includes("focus bg")) return { name: "Focus BG / FOCUS MEDIA LLC EOOD", code: "FOCUS_BG" };
  if (text.includes("focus")) return { name: "Focus Media", code: "FOCUS_MEDIA" };
  return null;
}

function payableStatus(remaining: number | null, paid: number | null, dueDate: Date | null, now: Date, soonDays: number) {
  if ((remaining || 0) <= 0) return "paid";
  if (!dueDate) return "needs_review";
  if (dueDate < now) return "overdue";
  if (sameUtcDay(dueDate, now)) return "due_today";
  if (daysBetween(now, dueDate) <= soonDays) return "due_soon";
  if ((paid || 0) > 0) return "paid_partial";
  return "in_term";
}

function receivableStatus(remaining: number | null, collected: number | null, dueDate: Date | null, now: Date, soonDays: number) {
  if ((remaining || 0) <= 0) return "collected";
  if (!dueDate) return "needs_review";
  if (dueDate < now) return "overdue";
  if (sameUtcDay(dueDate, now)) return "due_today";
  if (daysBetween(now, dueDate) <= soonDays) return "due_soon";
  if ((collected || 0) > 0) return "collected_partial";
  return "in_term";
}

function addMoneyIssue(
  issues: FinancialIssueInput[],
  notes: string[],
  company: { name: string; code: string },
  sheetName: string,
  rowNumber: number,
  field: string,
  rawValue: unknown,
  parsedValue: number | null,
  rawRowJson: FinancialRawJson
) {
  if (!hasValue(rawValue) || parsedValue != null) return;
  review(issues, notes, company, sheetName, rowNumber, `invalid_${field}`, `Valoarea numerica pentru ${field} nu poate fi citita.`, rawRowJson);
}

function review(
  issues: FinancialIssueInput[],
  notes: string[],
  company: { name: string; code: string },
  sheetName: string,
  rowNumber: number,
  issueType: string,
  issueMessage: string,
  rawRowJson: FinancialRawJson
) {
  notes.push(issueMessage);
  issues.push(issue(company.name, company.code, sheetName, rowNumber, issueType, issueMessage, "critical", rawRowJson));
}

function issue(
  companyName: string | null,
  companyCode: string | null,
  sheetName: string | null,
  rowNumber: number | null,
  issueType: string,
  issueMessage: string,
  severity: "info" | "warning" | "critical",
  rawRowJson: FinancialRawJson | null
): FinancialIssueInput {
  return { companyName, companyCode, sheetName, rowNumber, issueType, issueMessage, severity, rawRowJson };
}

function looksAuxiliary(text: string) {
  const normalized = normalizeText(text);
  return auxiliaryMarkers.some((marker) => normalized.includes(marker));
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\u00a0/g, " ").trim();
}

function jsonCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return cleanText(value);
}

function hasValue(value: unknown) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return cleanText(value) !== "";
}

function hasAnyValue(raw: FinancialRawJson) {
  return Object.values(raw).some(hasValue);
}

function parseMoney(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundMoney(value) : null;
  if (value instanceof Date) return null;
  let text = cleanText(value);
  if (!text || /^[-–—]+$/.test(text)) return null;
  text = text.replace(/\u00a0/g, " ").replace(/ron|eur|lei/gi, "").trim();
  if (!/[0-9]/.test(text)) return null;
  const negative = text.includes("(") && text.includes(")") || text.trim().startsWith("-");
  text = text.replace(/[()]/g, "").replace(/[^0-9,.-]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    text = text.replace(",", ".");
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(negative ? -Math.abs(parsed) : parsed);
}

function detectCurrency(values: unknown[], company: { code: string }): Currency | null {
  const explicit = values.map(explicitCurrency).filter(Boolean) as Currency[];
  const unique = [...new Set(explicit)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;
  return defaultCompanyCurrency(company);
}

function currencySource(values: unknown[], company: { code: string }) {
  const explicit = values.map(explicitCurrency).filter(Boolean);
  if (explicit.length) return "explicit_cell";
  return defaultCompanyCurrency(company) ? "inferred_company" : "missing";
}

function explicitCurrency(value: unknown): Currency | null {
  if (value == null || value instanceof Date || typeof value === "number" || typeof value === "boolean") return null;
  const text = normalizeText(value);
  const hasEur = /\b(eur|euro)\b/.test(text) || String(value).includes("€");
  const hasRon = /\b(ron|lei|leu)\b/.test(text);
  if (hasEur && hasRon) return null;
  if (hasEur) return "EUR";
  if (hasRon) return "RON";
  return null;
}

function defaultCompanyCurrency(company: { code: string }): Currency | null {
  if (company.code === "FOCUS_BG") return "EUR";
  if (company.code === "FOCUS_MEDIA" || company.code === "EXCELLENCE_MEDIA") return "RON";
  return null;
}

function parseDate(value: unknown) {
  if (!hasValue(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfUtcDay(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }
  const text = cleanText(value);
  const romanian = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (romanian) {
    const year = Number(romanian[3].length === 2 ? `20${romanian[3]}` : romanian[3]);
    return validUtcDate(year, Number(romanian[2]), Number(romanian[1]));
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed);
}

function parseDateFromText(text: string) {
  const match = text.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  return match ? validUtcDate(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

function validUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sameUtcDay(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function daysBetween(left: Date, right: Date) {
  return Math.ceil((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function sum<T>(rows: T[], key: keyof T) {
  return roundMoney(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));
}

function sumCurrency<T extends { currency: Currency | string | null; needsReview: boolean; includedInReport: boolean }>(
  rows: T[],
  key: keyof T,
  currency: Currency
) {
  return sum(rows.filter((row) => row.currency === currency && !row.needsReview && row.includedInReport), key);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
