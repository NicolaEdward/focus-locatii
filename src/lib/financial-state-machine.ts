export const FINANCIAL_UPLOAD_STATUSES = [
  "parsed",
  "preview_ready",
  "needs_review",
  "needs_confirmation",
  "confirmed",
  "rejected",
  "failed",
  "archived"
] as const;

export const RECEIVABLE_IMPORT_ROW_STATUSES = [
  "allocated_auto",
  "needs_confirmation",
  "manual",
  "conflict",
  "resolved",
  "ignored",
  "imported",
  "unchanged"
] as const;

export const RECEIVABLE_PAYMENT_STATUSES = ["active", "cancelled"] as const;

export type FinancialUploadStatus = (typeof FINANCIAL_UPLOAD_STATUSES)[number];
export type ReceivableImportRowStatus = (typeof RECEIVABLE_IMPORT_ROW_STATUSES)[number];
export type ReceivablePaymentStatus = (typeof RECEIVABLE_PAYMENT_STATUSES)[number];

const uploadTransitions: Record<FinancialUploadStatus, ReadonlySet<FinancialUploadStatus>> = {
  parsed: new Set(["parsed", "confirmed", "rejected", "archived"]),
  preview_ready: new Set(["preview_ready", "confirmed", "rejected", "archived"]),
  needs_review: new Set(["needs_review", "confirmed", "rejected", "archived"]),
  needs_confirmation: new Set(["needs_confirmation", "confirmed", "rejected", "archived"]),
  confirmed: new Set(["confirmed", "archived"]),
  rejected: new Set(["rejected", "archived"]),
  failed: new Set(["failed", "rejected", "archived"]),
  archived: new Set(["archived"])
};

const importRowTransitions: Record<ReceivableImportRowStatus, ReadonlySet<ReceivableImportRowStatus>> = {
  allocated_auto: new Set(["allocated_auto", "resolved", "ignored", "imported", "unchanged"]),
  needs_confirmation: new Set(["needs_confirmation", "resolved", "ignored"]),
  manual: new Set(["manual", "resolved", "ignored"]),
  conflict: new Set(["conflict", "resolved", "ignored"]),
  resolved: new Set(["resolved", "imported", "unchanged"]),
  ignored: new Set(["ignored"]),
  imported: new Set(["imported"]),
  unchanged: new Set(["unchanged"])
};

const paymentTransitions: Record<ReceivablePaymentStatus, ReadonlySet<ReceivablePaymentStatus>> = {
  active: new Set(["active", "cancelled"]),
  cancelled: new Set(["cancelled"])
};

export function assertFinancialUploadTransition(currentValue: unknown, nextValue: unknown) {
  return assertTransition("import financiar", FINANCIAL_UPLOAD_STATUSES, uploadTransitions, currentValue, nextValue);
}

export function assertReceivableImportRowTransition(currentValue: unknown, nextValue: unknown) {
  return assertTransition("rand de import", RECEIVABLE_IMPORT_ROW_STATUSES, importRowTransitions, currentValue, nextValue);
}

export function assertReceivablePaymentTransition(currentValue: unknown, nextValue: unknown) {
  return assertTransition("incasare", RECEIVABLE_PAYMENT_STATUSES, paymentTransitions, currentValue, nextValue);
}

function assertTransition<T extends string>(
  label: string,
  values: readonly T[],
  transitions: Record<T, ReadonlySet<T>>,
  currentValue: unknown,
  nextValue: unknown
) {
  const current = parseState(label, values, currentValue);
  const next = parseState(label, values, nextValue);
  if (!transitions[current].has(next)) {
    throw new Error(`Tranzitia pentru ${label} din ${current} in ${next} nu este permisa.`);
  }
  return next;
}

function parseState<T extends string>(label: string, values: readonly T[], value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!(values as readonly string[]).includes(normalized)) {
    throw new Error(`Status invalid pentru ${label}.`);
  }
  return normalized as T;
}
