import type { OperationStatus } from "@/lib/operation-status";

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
  currency: string;
  taskType: string;
  taskId: string | null;
  missingCost: boolean;
};

export type DecorationBillingReport = {
  month: string;
  rows: DecorationBillingRow[];
  totals: Record<string, number>;
  missingCostRows: DecorationBillingRow[];
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

  const rows = [...deduped.values()].sort((left, right) =>
    new Date(right.finalizationDate).getTime() - new Date(left.finalizationDate).getTime() ||
    new Date(right.scheduledDate || right.finalizationDate).getTime() - new Date(left.scheduledDate || left.finalizationDate).getTime() ||
    left.location.localeCompare(right.location) ||
    left.client.localeCompare(right.client)
  );
  const totals = rows.reduce<Record<string, number>>((sum, row) => {
    if (row.cost == null) return sum;
    sum[row.currency] = (sum[row.currency] || 0) + row.cost;
    return sum;
  }, {});

  return {
    month,
    rows,
    totals,
    missingCostRows: rows.filter((row) => row.missingCost)
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
    "Atentionare"
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
    row.currency,
    row.missingCost ? "Cost montaj lipsa" : ""
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
    ""
  ]);

  return `\uFEFF${[headers, ...rows, ...totalRows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
}

export function decorationBillingFileName(month: string) {
  return `facturare-montaj-${month || "luna"}.csv`;
}

function decorationBillingRow(task: DecorationBillingTaskLike, range: { from: Date; to: Date }): DecorationBillingRow | null {
  if (task.operationStatus !== "DONE") return null;
  if (EXCLUDED_RESERVATION_STATUSES.has(String(task.reservation.status || "").toUpperCase())) return null;

  const finalizationDate = validDate(task.finalizationDate) || validDate(task.taskDate);
  if (!finalizationDate || finalizationDate < range.from || finalizationDate >= range.to) return null;

  const scheduledDate = validDate(task.taskDate);
  const currency = task.currency || task.reservation.currency || "EUR";
  const cost = validCost(task.cost);

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
    taskType: task.taskType || "initial",
    taskId: task.taskId || null,
    missingCost: cost == null
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
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function taskTypeLabel(value: string) {
  return value === "redecoration" ? "Redecorare" : "Decorare initiala";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
