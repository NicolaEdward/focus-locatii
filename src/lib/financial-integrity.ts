import { financialStatus } from "@/lib/financial-review";
import { moneyNumber, roundMoney, type MoneyInput } from "@/lib/money";

export type FinancialKind = "payable" | "receivable";

const payableIncludedStatuses = new Set(["needs_review", "paid", "paid_partial", "overdue", "due_today", "due_soon", "in_term"]);
const receivableIncludedStatuses = new Set(["needs_review", "collected", "collected_partial", "overdue", "due_today", "due_soon", "in_term"]);
const inactiveStatuses = new Set(["excluded", "archived", "cancelled"]);

export function normalizeFinancialStatus(kind: FinancialKind, status: string | null | undefined) {
  if (status == null || !String(status).trim()) return null;
  const normalized = String(status).trim().toLowerCase();
  const allowed = kind === "payable" ? payableIncludedStatuses : receivableIncludedStatuses;
  if (!allowed.has(normalized) && !inactiveStatuses.has(normalized)) {
    throw new Error("Status financiar invalid.");
  }
  return normalized;
}

export function computeRemainingAmount(amount: MoneyInput, paidOrCollected: MoneyInput) {
  return roundMoney(Math.max(0, moneyNumber(amount) - moneyNumber(paidOrCollected)));
}

export function resolveFinancialRowEdit(input: {
  kind: FinancialKind;
  existingIncludedInReport: boolean;
  existingStatus: string | null;
  existingAmount: MoneyInput;
  existingPaidOrCollected: MoneyInput;
  existingRemaining: MoneyInput;
  existingDueDate?: Date | null;
  includeInReport?: boolean;
  amount?: MoneyInput;
  paidOrCollected?: MoneyInput;
  remaining?: MoneyInput;
  dueDate?: Date | null;
  currency?: string | null;
  status?: string | null;
}) {
  const includeInReport = input.includeInReport === undefined ? input.existingIncludedInReport : input.includeInReport;
  const amount = input.amount === undefined ? input.existingAmount : input.amount;
  const paidOrCollected = input.paidOrCollected === undefined ? input.existingPaidOrCollected : input.paidOrCollected;
  const dueDate = input.dueDate === undefined ? input.existingDueDate || null : input.dueDate;
  const explicitStatus = input.status === undefined ? undefined : normalizeFinancialStatus(input.kind, input.status);
  const financialValuesChanged = input.amount !== undefined || input.paidOrCollected !== undefined || input.status !== undefined;

  let remaining = input.remaining === undefined ? moneyNumber(input.existingRemaining) : moneyNumber(input.remaining);
  if (financialValuesChanged) {
    remaining = computeRemainingAmount(amount, paidOrCollected);
  } else if (remaining < 0) {
    throw new Error("Restul financiar nu poate fi negativ.");
  }

  if (!includeInReport) {
    const existingStatus = normalizeFinancialStatus(input.kind, input.existingStatus);
    const status = explicitStatus && inactiveStatuses.has(explicitStatus)
      ? explicitStatus
      : existingStatus && inactiveStatuses.has(existingStatus)
        ? existingStatus
        : "excluded";
    return {
      includeInReport,
      amount,
      paidOrCollected,
      remaining,
      dueDate,
      status,
      needsReview: false
    };
  }

  if (explicitStatus && inactiveStatuses.has(explicitStatus)) {
    throw new Error("Statusul exclus/arhivat nu poate fi folosit pentru un rand inclus in raport.");
  }

  const derivedStatus = financialStatus({ kind: input.kind, remainingAmount: remaining, paidOrCollected, dueDate });
  if (explicitStatus && explicitStatus !== derivedStatus && explicitStatus !== "needs_review") {
    throw new Error("Statusul financiar nu corespunde sumelor si scadentei.");
  }

  const preservedStatus = normalizeFinancialStatus(input.kind, input.existingStatus);
  const status = explicitStatus || (financialValuesChanged || input.dueDate !== undefined ? derivedStatus : preservedStatus || derivedStatus);
  return {
    includeInReport,
    amount,
    paidOrCollected,
    remaining,
    dueDate,
    status,
    needsReview: status === "needs_review" || !["RON", "EUR"].includes(String(input.currency || ""))
  };
}

export function assertReceivablePaymentStatus(status: string | null | undefined) {
  const normalized = normalizeFinancialStatus("receivable", status || "needs_review");
  if (normalized && inactiveStatuses.has(normalized)) {
    throw new Error("Factura nu poate fi incasata in statusul curent.");
  }
}

export function calculateReceivablePayment(input: {
  invoiceAmount: MoneyInput;
  previousCollected: MoneyInput;
  paymentAmount: MoneyInput;
  mode: "add" | "set";
  dueDate?: Date | null;
}) {
  const total = moneyNumber(input.invoiceAmount);
  const paymentAmount = moneyNumber(input.paymentAmount);
  if (paymentAmount < 0) throw new Error("Suma incasata nu poate fi negativa.");
  const previousCollected = moneyNumber(input.previousCollected);
  const collected = roundMoney(input.mode === "set" ? paymentAmount : previousCollected + paymentAmount);
  if (collected > total) {
    throw new Error("Suma incasata nu poate depasi valoarea facturii.");
  }
  const remaining = computeRemainingAmount(total, collected);
  const status = remaining <= 0
    ? "collected"
    : collected > 0
      ? "collected_partial"
      : financialStatus({ kind: "receivable", remainingAmount: remaining, paidOrCollected: collected, dueDate: input.dueDate });

  return { total, previousCollected, collected, remaining, status };
}

export function validateReceivableDuplicateMerge(primary: ReceivableDuplicateInput, duplicate: ReceivableDuplicateInput) {
  if (primary.id === duplicate.id) throw new Error("Alege doua facturi diferite.");
  if (primary.uploadId !== duplicate.uploadId) {
    throw new Error("Facturile trebuie sa apartina aceluiasi raport financiar.");
  }
  if (companyIdentity(primary) !== companyIdentity(duplicate)) {
    throw new Error("Facturile trebuie sa apartina aceleiasi companii.");
  }
  const primaryInvoice = invoiceIdentity(primary);
  const duplicateInvoice = invoiceIdentity(duplicate);
  if (!primaryInvoice || primaryInvoice !== duplicateInvoice) {
    throw new Error("Facturile nu au acelasi numar de factura normalizat.");
  }
  const primaryClient = clientIdentity(primary);
  const duplicateClient = clientIdentity(duplicate);
  if (primaryClient && duplicateClient && primaryClient !== duplicateClient) {
    throw new Error("Facturile au clienti diferiti si nu pot fi combinate ca duplicate.");
  }
  if (primary.currency && duplicate.currency && primary.currency !== duplicate.currency) {
    throw new Error("Facturile au monede diferite.");
  }
  if (hasMoney(primary.invoicedAmount) && hasMoney(duplicate.invoicedAmount) && Math.abs(moneyNumber(primary.invoicedAmount) - moneyNumber(duplicate.invoicedAmount)) > 0.01) {
    throw new Error("Facturile au valori diferite.");
  }
  if (primary.invoiceDate && duplicate.invoiceDate && utcDay(primary.invoiceDate) !== utcDay(duplicate.invoiceDate)) {
    throw new Error("Facturile au date de emitere diferite.");
  }
}

export function matchingFinancialIssueIds(row: FinancialIssueRowIdentity, issues: FinancialIssueCandidate[]) {
  const rowIdentity = issueRowIdentity(row);
  if (!rowIdentity.rowNumber) return [];
  const uploadAndRowMatches = issues.filter((issue) =>
    issue.uploadId === rowIdentity.uploadId &&
    issue.rowNumber === rowIdentity.rowNumber &&
    issue.resolvedAt == null
  );
  const strictMatches = uploadAndRowMatches.filter((issue) => issueMatchesRow(rowIdentity, issueIdentity(issue)));
  if (strictMatches.length) return strictMatches.map((issue) => issue.id);
  if (uploadAndRowMatches.length === 1 && !hasStableIssueIdentity(issueIdentity(uploadAndRowMatches[0]))) {
    return [uploadAndRowMatches[0].id];
  }
  return [];
}

type ReceivableDuplicateInput = {
  id: string;
  uploadId: string;
  companyCode: string | null;
  companyName: string | null;
  normalizedInvoiceNumber: string | null;
  invoiceNumber: string | null;
  clientId: string | null;
  clientName: string | null;
  currency: string | null;
  invoicedAmount: MoneyInput;
  invoiceDate?: Date | null;
};

export type FinancialIssueRowIdentity = {
  uploadId: string;
  companyCode?: string | null;
  companyName?: string | null;
  rawRowJson?: unknown;
};

export type FinancialIssueCandidate = {
  id: string;
  uploadId: string;
  companyCode: string | null;
  companyName: string | null;
  sheetName: string | null;
  rowNumber: number | null;
  rawRowJson?: unknown;
  resolvedAt?: Date | null;
};

function issueMatchesRow(row: ReturnType<typeof issueRowIdentity>, issue: ReturnType<typeof issueIdentity>) {
  if (row.sheetName && issue.sheetName && row.sheetName !== issue.sheetName) return false;
  if (row.companyCode && issue.companyCode && row.companyCode !== issue.companyCode) return false;
  if (!row.companyCode && !issue.companyCode && row.companyName && issue.companyName && row.companyName !== issue.companyName) return false;
  if (row.kind && issue.kind && row.kind !== issue.kind) return false;
  return hasStableIssueIdentity(row) && hasStableIssueIdentity(issue);
}

function issueRowIdentity(row: FinancialIssueRowIdentity) {
  const raw = rawObject(row.rawRowJson);
  return {
    uploadId: row.uploadId,
    companyCode: normalizeComparable(row.companyCode),
    companyName: normalizeComparable(row.companyName),
    sheetName: normalizeComparable(raw.sheetName),
    rowNumber: Number(raw.rowNumber) || null,
    kind: issueKind(raw)
  };
}

function issueIdentity(issue: FinancialIssueCandidate) {
  const raw = rawObject(issue.rawRowJson);
  return {
    uploadId: issue.uploadId,
    companyCode: normalizeComparable(issue.companyCode),
    companyName: normalizeComparable(issue.companyName),
    sheetName: normalizeComparable(issue.sheetName || raw.sheetName),
    rowNumber: issue.rowNumber,
    kind: issueKind(raw)
  };
}

function hasStableIssueIdentity(identity: { companyCode?: string | null; companyName?: string | null; sheetName?: string | null; kind?: string | null }) {
  return Boolean(identity.companyCode || identity.companyName || identity.sheetName || identity.kind);
}

function issueKind(raw: Record<string, unknown>) {
  if ("amountToPay" in raw || "supplierName" in raw || "documentDescription" in raw) return "payable";
  if ("invoicedAmount" in raw || "clientName" in raw || "campaignDetails" in raw || "location" in raw) return "receivable";
  return null;
}

function rawObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasMoney(value: MoneyInput) {
  return value != null && String(value) !== "";
}

function companyIdentity(row: ReceivableDuplicateInput) {
  return normalizeComparable(row.companyCode) || normalizeComparable(row.companyName);
}

function invoiceIdentity(row: ReceivableDuplicateInput) {
  return normalizeComparable(row.normalizedInvoiceNumber) || normalizeInvoiceText(row.invoiceNumber);
}

function clientIdentity(row: ReceivableDuplicateInput) {
  return row.clientId || normalizeComparable(row.clientName);
}

function normalizeInvoiceText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(factura|fact|nr|numar|number|invoice|inv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeComparable(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function utcDay(value: Date) {
  return value.toISOString().slice(0, 10);
}
