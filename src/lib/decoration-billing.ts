import type { OperationStatus } from "@/lib/operation-status";
import { escapeSpreadsheetFormula } from "@/lib/spreadsheet-export";

export type DecorationBillingReservationLike = {
  id: string;
  status?: string | null;
  clientName?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  contractNumber?: string | null;
  locationId?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
  currency?: string | null;
};

export type DecorationBillingTaskLike = {
  reservation: DecorationBillingReservationLike;
  taskDate?: string | null;
  finalizationDate?: string | null;
  operationStatus: OperationStatus | string;
  taskId?: string | null;
  taskType?: string | null;
  note?: string | null;
  cost?: number | null;
  currency?: string | null;
  dedupeKey?: string | null;
};

export type DecorationBillingRow = {
  key: string;
  reservationId: string;
  locationId: string | null;
  campaignReference: string;
  client: string;
  campaign: string;
  location: string;
  finalizationDate: string;
  scheduledDate: string | null;
  status: "DONE";
  cost: number | null;
  currency: "RON" | "EUR" | null;
  sourceCurrency: string | null;
  taskType: string;
  taskId: string | null;
  missingCost: boolean;
  missingCurrency: boolean;
  reservationStatus: string;
  billingReview: "verify_before_billing" | "rental_status_review";
  completionDateSource: "completed" | "scheduled_fallback";
};

export type DecorationBillingReport = {
  month: string;
  rows: DecorationBillingRow[];
  /** Physical work survives cancellation; this is evidence, not an invoice authorization. */
  executionRows: DecorationBillingRow[];
  totals: Record<string, number>;
  missingCostRows: DecorationBillingRow[];
  missingCurrencyRows: DecorationBillingRow[];
};

const EXCLUDED_RESERVATION_STATUSES = new Set(["CANCELLED", "EXPIRED", "ARCHIVED", "LOST"]);

export function buildDecorationBillingReport(tasks: DecorationBillingTaskLike[], month: string): DecorationBillingReport {
  const range = monthRange(month);
  const deduped = new Map<string, DecorationBillingRow>();

  if (range) {
    for (const task of tasks) {
      const row = decorationBillingRow(task, range);
      if (!row) continue;

      const existing = deduped.get(row.key);
      deduped.set(row.key, preferBillingRow(existing, row));
    }
  }

  const executionRows = [...deduped.values()].sort((left, right) =>
    new Date(right.finalizationDate).getTime() - new Date(left.finalizationDate).getTime() ||
    new Date(right.scheduledDate || right.finalizationDate).getTime() - new Date(left.scheduledDate || left.finalizationDate).getTime() ||
    left.location.localeCompare(right.location) ||
    left.client.localeCompare(right.client)
  );
  const rows = executionRows.filter((row) => row.billingReview !== "rental_status_review");
  const totals = rows.reduce<Record<string, number>>((sum, row) => {
    if (row.cost == null || row.currency == null) return sum;
    sum[row.currency] = (Math.round((sum[row.currency] || 0) * 100) + Math.round(row.cost * 100)) / 100;
    return sum;
  }, {});

  return {
    month,
    rows,
    executionRows,
    totals,
    missingCostRows: rows.filter((row) => row.missingCost),
    missingCurrencyRows: rows.filter((row) => row.missingCurrency)
  };
}

export function decorationBillingCsv(report: DecorationBillingReport) {
  const headers = [
    "Luna",
    "Data finalizare",
    "Client",
    "Campanie",
    "Locatie",
    "Tip montaj",
    "Status",
    "Cost",
    "Moneda",
    "Atentionare",
    "Stare inchiriere",
    "Verificare facturabilitate"
  ];
  const rows = report.rows.map((row) => [
    report.month,
    row.finalizationDate.slice(0, 10),
    row.client,
    row.campaign,
    row.location,
    taskTypeLabel(row.taskType),
    row.status,
    row.cost == null ? "" : String(row.cost),
    row.currency || row.sourceCurrency || "",
    [row.missingCost ? "Cost montaj lipsa sau invalid" : "", row.missingCurrency ? "Moneda montaj neverificata" : "", row.completionDateSource === "scheduled_fallback" ? "Data executiei neverificata" : ""].filter(Boolean).join("; "),
    row.reservationStatus,
    "Necesita verificare inainte de facturare"
  ]);
  const totalRows = Object.entries(report.totals).map(([currency, value]) => [
    report.month,
    "",
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    String(value),
    currency,
    "",
    "",
    ""
  ]);

  return `\uFEFF${[headers, ...rows, ...totalRows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

export function decorationBillingFileName(month: string) {
  return `facturare-montaj-${month || "luna"}.csv`;
}

function decorationBillingRow(task: DecorationBillingTaskLike, range: { from: Date; to: Date }): DecorationBillingRow | null {
  if (task.operationStatus !== "DONE") return null;
  const actualCompletionDate = validDate(task.finalizationDate);
  const finalizationDate = actualCompletionDate || validDate(task.taskDate);
  if (!finalizationDate || finalizationDate < range.from || finalizationDate >= range.to) return null;

  const scheduledDate = validDate(task.taskDate);
  // Rental income and installation cost can use different currencies. An absent
  // cost currency is not evidence that it is EUR or the rental's currency.
  const sourceCurrency = String(task.currency || "").trim().toUpperCase() || null;
  const currency = sourceCurrency === "RON" || sourceCurrency === "EUR" ? sourceCurrency : null;
  const cost = validCost(task.cost);
  const reservationStatus = String(task.reservation.status || "").toUpperCase();

  return {
    key: task.dedupeKey || decorationBillingDedupeKey(task),
    reservationId: task.reservation.id,
    locationId: task.reservation.locationId || null,
    campaignReference: task.reservation.contractNumber || "",
    client: task.reservation.clientName || "Client nesetat",
    campaign: task.reservation.campaignName || "Campanie nesetata",
    location: [task.reservation.locationCode, task.reservation.locationName].filter(Boolean).join(" - ") || task.reservation.locationId || "Locatie nesetata",
    finalizationDate: finalizationDate.toISOString(),
    scheduledDate: scheduledDate ? scheduledDate.toISOString() : null,
    status: "DONE",
    cost,
    currency,
    sourceCurrency,
    taskType: task.taskType || "initial",
    taskId: task.taskId || null,
    missingCost: cost == null,
    missingCurrency: currency == null,
    reservationStatus,
    billingReview: EXCLUDED_RESERVATION_STATUSES.has(reservationStatus) ? "rental_status_review" : "verify_before_billing",
    completionDateSource: actualCompletionDate ? "completed" : "scheduled_fallback"
  };
}

function decorationBillingDedupeKey(task: DecorationBillingTaskLike) {
  const taskId = typeof task.taskId === "string" && task.taskId.trim() ? task.taskId.trim() : null;
  return taskId ? `reservation:${task.reservation.id}:task:${taskId}` : `reservation:${task.reservation.id}:DECORATION:base`;
}

function preferBillingRow(existing: DecorationBillingRow | undefined, next: DecorationBillingRow) {
  if (!existing) return next;
  if (existing.missingCost && !next.missingCost) return next;
  if (!existing.missingCost && next.missingCost) return existing;
  return next;
}

function monthRange(month: string) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) return null;
  return {
    from: new Date(Date.UTC(year, monthIndex, 1)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1))
  };
}

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validCost(value?: number | null) {
  if (value == null) return null;
  return Number.isFinite(value) && value >= 0 && Math.round(value * 100) / 100 === value ? value : null;
}

function taskTypeLabel(value: string) {
  return value === "redecoration" ? "Redecorare" : "Decorare initiala";
}

function csvCell(value: unknown) {
  const text = String(escapeSpreadsheetFormula(value) ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
