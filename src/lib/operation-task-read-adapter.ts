import { prisma } from "@/lib/prisma";
import {
  isOperationActive,
  operationExtraTasks,
  operationStatus,
  type OperationKind,
  type OperationStatus
} from "@/lib/operation-status";
import {
  buildOperationTaskDedupeKey,
  type OperationTaskKind,
  type OperationTaskStatus
} from "@/lib/operation-tasks";
import type { Prisma } from "@prisma/client";

type OperationTaskReadClient = typeof prisma;

export type OperationTaskReadReservation = {
  id: string;
  campaignId?: string | null;
  locationId?: string | null;
  status: string;
  clientName: string;
  campaignName?: string | null;
  salesperson?: string | null;
  periodStart: Date | string;
  periodEnd: Date | string;
  installationDate?: Date | string | null;
  neutralizationDate?: Date | string | null;
  productionNotes?: string | null;
  sellerUser?: { name: string | null } | null;
  location: {
    id?: string | null;
    code: string;
    city?: string | null;
  };
};

export type OperationTaskReadRecord = {
  id: string;
  reservationId: string | null;
  campaignId?: string | null;
  locationId?: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  source?: string;
  dedupeKey: string | null;
  legacyTaskId?: string | null;
  scheduledFor?: Date | string | null;
  completedAt?: Date | string | null;
  notes?: string | null;
  reservation?: OperationTaskReadReservation | null;
};

export type OperationalTaskDto = {
  id: string;
  reservationId: string;
  taskId: string | null;
  operationTaskId?: string | null;
  kind: OperationKind;
  taskKind: Exclude<OperationTaskKind, "MAINTENANCE">;
  status: OperationStatus;
  taskDate: string;
  overdue: boolean;
  note: string | null;
  code: string;
  city: string | null;
  clientName: string;
  campaignName: string | null;
  salesperson: string;
  periodStart: string;
  periodEnd: string;
  source: "relational" | "legacy";
  dedupeKey: string | null;
};

export type OperationTaskReadFilters = {
  reservations?: OperationTaskReadReservation[];
  relationalTasks?: OperationTaskReadRecord[];
  now?: Date;
  windowStart?: Date;
  decorationWindowEnd?: Date;
  neutralizationWindowEnd?: Date;
  includeHistory?: boolean;
  kind?: OperationKind;
};

export type OperationTaskReadComparison = {
  legacyActiveCount: number;
  relationalFallbackActiveCount: number;
  legacyHistoryCount: number;
  relationalFallbackHistoryCount: number;
  mismatchedDedupeKeys: string[];
  missingRelationalDedupeKeys: string[];
  missingLegacyDedupeKeys: string[];
  doubleCountRiskCount: number;
  sampleMismatches: Array<{
    dedupeKey: string;
    reason: string;
    legacy?: Pick<OperationalTaskDto, "status" | "taskDate" | "kind">;
    relational?: Pick<OperationalTaskDto, "status" | "taskDate" | "kind">;
  }>;
};

export type OperationTaskReadResult = {
  tasks: OperationalTaskDto[];
  active: OperationalTaskDto[];
  archived: OperationalTaskDto[];
  legacyTasks: OperationalTaskDto[];
  relationalTasks: OperationalTaskDto[];
  fallbackTasks: OperationalTaskDto[];
  comparison: OperationTaskReadComparison;
};

const RELATIONAL_TASK_KINDS: OperationTaskKind[] = ["DECORATION", "NEUTRALIZATION", "REDECORATION"];
const ACTIVE_STATUSES = new Set<OperationStatus>(["NEW", "IN_PROGRESS"]);
const HISTORY_STATUSES = new Set<OperationStatus>(["DONE", "ARCHIVED"]);

export function operationTaskReadsEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV === "production") return false;
  return ["1", "true", "yes"].includes(String(env.OPERATION_TASK_READS_ENABLED || "").toLowerCase());
}

export async function listOperationalTasksWithFallback(
  filters: OperationTaskReadFilters = {},
  client: OperationTaskReadClient = prisma
): Promise<OperationTaskReadResult> {
  const now = filters.now || new Date();
  const reservationRows = filters.reservations || await loadReservationsForTaskReads(filters, client);
  const relationalRecords = filters.relationalTasks || await loadRelationalTasks(reservationRows.map((reservation) => reservation.id), filters, client);
  const reservations = mergeReservationRows(reservationRows, relationalRecords.map((task) => task.reservation).filter(Boolean) as OperationTaskReadReservation[]);
  const reservationMap = new Map(reservations.map((reservation) => [reservation.id, reservation]));
  const legacyTasks = reservations.flatMap((reservation) => legacyTasksFromReservation(reservation, now));
  const relationalTasks = relationalRecords
    .map((task) => toLegacyOperationalTaskDto(task, task.reservation || reservationMap.get(String(task.reservationId || "")) || null, now))
    .filter((task): task is OperationalTaskDto => Boolean(task));

  const tasks = filterTasksForKind(mergeRelationalWithLegacyFallback(relationalTasks, legacyTasks), filters.kind);
  const active = tasks
    .filter((task) => ACTIVE_STATUSES.has(task.status) && taskInActiveWindow(task, filters))
    .sort(sortTasksByDate);
  const archived = tasks
    .filter((task) => HISTORY_STATUSES.has(task.status))
    .sort(sortTasksByDate);
  const fallbackKeys = new Set(relationalTasks.map(taskKey));
  const fallbackTasks = legacyTasks.filter((task) => !fallbackKeys.has(taskKey(task)));

  return {
    tasks,
    active,
    archived,
    legacyTasks,
    relationalTasks,
    fallbackTasks,
    comparison: compareLegacyAndRelationalTaskLists({ legacyTasks, relationalTasks, mergedTasks: tasks, filters })
  };
}

export async function listActiveOperationTasks(
  filters: OperationTaskReadFilters = {},
  client: OperationTaskReadClient = prisma
) {
  const result = await listOperationalTasksWithFallback(filters, client);
  return result.active;
}

export async function listArchivedOperationTasks(
  filters: OperationTaskReadFilters = {},
  client: OperationTaskReadClient = prisma
) {
  const result = await listOperationalTasksWithFallback({ ...filters, includeHistory: true }, client);
  return result.archived;
}

export function compareLegacyAndRelationalTaskLists(input: {
  legacyTasks: OperationalTaskDto[];
  relationalTasks: OperationalTaskDto[];
  mergedTasks?: OperationalTaskDto[];
  filters?: OperationTaskReadFilters;
}): OperationTaskReadComparison {
  const legacyByKey = keyedTasks(input.legacyTasks);
  const relationalByKey = keyedTasks(input.relationalTasks);
  const allKeys = new Set([...legacyByKey.keys(), ...relationalByKey.keys()]);
  const mismatchedDedupeKeys: string[] = [];
  const missingRelationalDedupeKeys: string[] = [];
  const missingLegacyDedupeKeys: string[] = [];
  const sampleMismatches: OperationTaskReadComparison["sampleMismatches"] = [];

  for (const key of allKeys) {
    const legacy = legacyByKey.get(key);
    const relational = relationalByKey.get(key);
    if (!legacy && relational) {
      missingLegacyDedupeKeys.push(key);
      pushSample(sampleMismatches, key, "missing legacy task", undefined, relational);
      continue;
    }
    if (legacy && !relational) {
      missingRelationalDedupeKeys.push(key);
      pushSample(sampleMismatches, key, "missing relational task", legacy, undefined);
      continue;
    }
    if (legacy && relational && taskSignature(legacy) !== taskSignature(relational)) {
      mismatchedDedupeKeys.push(key);
      pushSample(sampleMismatches, key, "status/date/kind mismatch", legacy, relational);
    }
  }

  const merged = input.mergedTasks || mergeRelationalWithLegacyFallback(input.relationalTasks, input.legacyTasks);
  const duplicateKeys = new Set([
    ...duplicatedTaskKeys(input.relationalTasks),
    ...duplicatedTaskKeys(input.legacyTasks),
    ...duplicatedTaskKeys(merged)
  ]);
  const activeLegacy = input.legacyTasks.filter((task) => ACTIVE_STATUSES.has(task.status) && taskInActiveWindow(task, input.filters || {}));
  const activeMerged = merged.filter((task) => ACTIVE_STATUSES.has(task.status) && taskInActiveWindow(task, input.filters || {}));
  const historyLegacy = input.legacyTasks.filter((task) => HISTORY_STATUSES.has(task.status));
  const historyMerged = merged.filter((task) => HISTORY_STATUSES.has(task.status));

  return {
    legacyActiveCount: activeLegacy.length,
    relationalFallbackActiveCount: activeMerged.length,
    legacyHistoryCount: historyLegacy.length,
    relationalFallbackHistoryCount: historyMerged.length,
    mismatchedDedupeKeys,
    missingRelationalDedupeKeys,
    missingLegacyDedupeKeys,
    doubleCountRiskCount: duplicateKeys.size,
    sampleMismatches
  };
}

export function toLegacyOperationalTaskDto(
  task: OperationTaskReadRecord,
  reservation?: OperationTaskReadReservation | null,
  now: Date = new Date()
): OperationalTaskDto | null {
  const legacyKind = legacyKindForTask(task.kind);
  const status = toLegacyStatus(task.status);
  if (!legacyKind || !status || !reservation) return null;
  if (reservation.status !== "BOOKED") return null;

  const scheduledFor = coerceDate(task.scheduledFor) || fallbackTaskDate(reservation, legacyKind);
  if (!scheduledFor) return null;

  const taskId = task.legacyTaskId || null;
  return {
    id: legacyTaskId(legacyKind, reservation.id, taskId),
    reservationId: reservation.id,
    taskId,
    operationTaskId: task.id,
    kind: legacyKind,
    taskKind: task.kind as Exclude<OperationTaskKind, "MAINTENANCE">,
    status,
    taskDate: scheduledFor.toISOString(),
    overdue: ACTIVE_STATUSES.has(status) && scheduledFor < now,
    note: task.notes || null,
    code: reservation.location.code,
    city: reservation.location.city || null,
    clientName: reservation.clientName,
    campaignName: reservation.campaignName || null,
    salesperson: sellerName(reservation),
    periodStart: coerceDate(reservation.periodStart)?.toISOString() || "",
    periodEnd: coerceDate(reservation.periodEnd)?.toISOString() || "",
    source: "relational",
    dedupeKey: task.dedupeKey
  };
}

export function mergeRelationalWithLegacyFallback(
  relationalTasks: OperationalTaskDto[],
  legacyTasks: OperationalTaskDto[]
) {
  const merged = new Map<string, OperationalTaskDto>();
  for (const task of relationalTasks) merged.set(taskKey(task), task);
  for (const task of legacyTasks) {
    const key = taskKey(task);
    if (!merged.has(key)) merged.set(key, task);
  }
  return [...merged.values()].sort(sortTasksByDate);
}

export function reportOperationTaskReadComparison(comparison: OperationTaskReadComparison, env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV === "production") return;
  if (!operationTaskReadsEnabled(env)) return;

  const summary = {
    legacyActiveCount: comparison.legacyActiveCount,
    relationalFallbackActiveCount: comparison.relationalFallbackActiveCount,
    legacyHistoryCount: comparison.legacyHistoryCount,
    relationalFallbackHistoryCount: comparison.relationalFallbackHistoryCount,
    mismatchedDedupeKeys: comparison.mismatchedDedupeKeys.length,
    missingRelationalDedupeKeys: comparison.missingRelationalDedupeKeys.length,
    missingLegacyDedupeKeys: comparison.missingLegacyDedupeKeys.length,
    doubleCountRiskCount: comparison.doubleCountRiskCount,
    sampleMismatches: comparison.sampleMismatches
  };

  if (
    comparison.mismatchedDedupeKeys.length ||
    comparison.missingRelationalDedupeKeys.length ||
    comparison.missingLegacyDedupeKeys.length ||
    comparison.doubleCountRiskCount
  ) {
    console.warn("OperationTask read adapter comparison found differences.", summary);
  } else {
    console.info("OperationTask read adapter comparison matched legacy task list.", summary);
  }
}

function legacyTasksFromReservation(reservation: OperationTaskReadReservation, now: Date): OperationalTaskDto[] {
  if (reservation.status !== "BOOKED") return [];
  return [
    legacyBaseTask(reservation, "decoration", now),
    legacyBaseTask(reservation, "neutralization", now),
    ...operationExtraTasks(reservation.productionNotes, "decoration").flatMap((task) => legacyExtraTask(reservation, task, now)),
    ...operationExtraTasks(reservation.productionNotes, "neutralization").flatMap((task) => legacyExtraTask(reservation, task, now))
  ].filter((task): task is OperationalTaskDto => Boolean(task));
}

function legacyBaseTask(reservation: OperationTaskReadReservation, kind: OperationKind, now: Date): OperationalTaskDto | null {
  const taskDate = fallbackTaskDate(reservation, kind);
  if (!taskDate) return null;
  const taskKind = kind === "decoration" ? "DECORATION" : "NEUTRALIZATION";
  const status = operationStatus(reservation.productionNotes, kind);
  return {
    id: legacyTaskId(kind, reservation.id, null),
    reservationId: reservation.id,
    taskId: null,
    kind,
    taskKind,
    status,
    taskDate: taskDate.toISOString(),
    overdue: isOperationActive(status) && taskDate < now,
    note: null,
    code: reservation.location.code,
    city: reservation.location.city || null,
    clientName: reservation.clientName,
    campaignName: reservation.campaignName || null,
    salesperson: sellerName(reservation),
    periodStart: coerceDate(reservation.periodStart)?.toISOString() || "",
    periodEnd: coerceDate(reservation.periodEnd)?.toISOString() || "",
    source: "legacy",
    dedupeKey: buildOperationTaskDedupeKey({ reservationId: reservation.id, kind: taskKind, variant: "base" })
  };
}

function legacyExtraTask(
  reservation: OperationTaskReadReservation,
  task: ReturnType<typeof operationExtraTasks>[number],
  now: Date
): OperationalTaskDto[] {
  const taskKind = legacyExtraTaskKind(task);
  const scheduledFor = coerceDate(task.taskDate || task.requestedDate);
  if (!taskKind || !scheduledFor) return [];
  return [{
    id: legacyTaskId(task.kind, reservation.id, task.id),
    reservationId: reservation.id,
    taskId: task.id,
    kind: task.kind,
    taskKind,
    status: task.status,
    taskDate: scheduledFor.toISOString(),
    overdue: isOperationActive(task.status) && scheduledFor < now,
    note: task.note || null,
    code: reservation.location.code,
    city: reservation.location.city || null,
    clientName: reservation.clientName,
    campaignName: reservation.campaignName || null,
    salesperson: sellerName(reservation),
    periodStart: coerceDate(reservation.periodStart)?.toISOString() || "",
    periodEnd: coerceDate(reservation.periodEnd)?.toISOString() || "",
    source: "legacy",
    dedupeKey: buildOperationTaskDedupeKey({
      reservationId: reservation.id,
      kind: taskKind,
      legacyTaskId: task.id,
      variant: "legacy-extra"
    })
  }];
}

async function loadReservationsForTaskReads(filters: OperationTaskReadFilters, client: OperationTaskReadClient) {
  const now = filters.now || new Date();
  const windowStart = filters.windowStart || new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const decorationWindowEnd = filters.decorationWindowEnd || new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
  const neutralizationWindowEnd = filters.neutralizationWindowEnd || new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  return client.reservation.findMany({
    where: {
      status: "BOOKED",
      OR: [
        { installationDate: { gte: windowStart, lte: decorationWindowEnd } },
        { neutralizationDate: { gte: windowStart, lte: neutralizationWindowEnd } },
        { installationDate: null, periodStart: { gte: windowStart, lte: decorationWindowEnd } },
        { neutralizationDate: null, periodEnd: { gte: windowStart, lte: neutralizationWindowEnd } }
      ]
    },
    include: {
      sellerUser: { select: { name: true } },
      location: { select: { id: true, code: true, city: true } }
    },
    orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }, { createdAt: "desc" }],
    take: 1000
  }) as Promise<OperationTaskReadReservation[]>;
}

async function loadRelationalTasks(reservationIds: string[], filters: OperationTaskReadFilters, client: OperationTaskReadClient) {
  const now = filters.now || new Date();
  const windowStart = filters.windowStart || new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const maxWindowEnd = latestDate([
    filters.decorationWindowEnd || new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
    filters.neutralizationWindowEnd || new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  ]);
  const scope: Prisma.OperationTaskWhereInput[] = [{ scheduledFor: { gte: windowStart, lte: maxWindowEnd } }];
  if (reservationIds.length) scope.unshift({ reservationId: { in: reservationIds } });

  return client.operationTask.findMany({
    where: {
      kind: { in: RELATIONAL_TASK_KINDS },
      ...(scope.length ? { OR: scope } : {})
    },
    include: {
      reservation: {
        include: {
          sellerUser: { select: { name: true } },
          location: { select: { id: true, code: true, city: true } }
        }
      }
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }]
  }) as Promise<OperationTaskReadRecord[]>;
}

function mergeReservationRows(left: OperationTaskReadReservation[], right: OperationTaskReadReservation[]) {
  const rows = new Map<string, OperationTaskReadReservation>();
  for (const reservation of left) rows.set(reservation.id, reservation);
  for (const reservation of right) rows.set(reservation.id, reservation);
  return [...rows.values()];
}

function filterTasksForKind(tasks: OperationalTaskDto[], kind?: OperationKind) {
  return kind ? tasks.filter((task) => task.kind === kind) : tasks;
}

function taskInActiveWindow(task: OperationalTaskDto, filters: OperationTaskReadFilters) {
  const taskDate = coerceDate(task.taskDate);
  if (!taskDate) return false;
  const windowStart = filters.windowStart;
  const windowEnd = task.kind === "neutralization" ? filters.neutralizationWindowEnd : filters.decorationWindowEnd;
  return (!windowStart || taskDate >= windowStart) && (!windowEnd || taskDate <= windowEnd);
}

function fallbackTaskDate(reservation: OperationTaskReadReservation, kind: OperationKind) {
  return kind === "decoration"
    ? coerceDate(reservation.installationDate) || coerceDate(reservation.periodStart)
    : coerceDate(reservation.neutralizationDate) || coerceDate(reservation.periodEnd);
}

function legacyKindForTask(kind: OperationTaskKind): OperationKind | null {
  if (kind === "DECORATION" || kind === "REDECORATION") return "decoration";
  if (kind === "NEUTRALIZATION") return "neutralization";
  return null;
}

function legacyExtraTaskKind(task: ReturnType<typeof operationExtraTasks>[number]): Exclude<OperationTaskKind, "MAINTENANCE"> | null {
  if (task.kind === "decoration" && task.taskType === "redecoration") return "REDECORATION";
  if (task.kind === "decoration") return "DECORATION";
  if (task.kind === "neutralization") return "NEUTRALIZATION";
  return null;
}

function toLegacyStatus(status: OperationTaskStatus): OperationStatus | null {
  if (status === "NEW" || status === "IN_PROGRESS" || status === "DONE" || status === "ARCHIVED") return status;
  return null;
}

function sellerName(reservation: OperationTaskReadReservation) {
  return reservation.sellerUser?.name || reservation.salesperson || "Nealocat";
}

function taskKey(task: OperationalTaskDto) {
  return task.dedupeKey || `${task.reservationId}:${task.kind}:${task.taskId || "base"}:${task.taskDate}`;
}

function keyedTasks(tasks: OperationalTaskDto[]) {
  const map = new Map<string, OperationalTaskDto>();
  for (const task of tasks) {
    const key = taskKey(task);
    if (!map.has(key)) map.set(key, task);
  }
  return map;
}

function duplicatedTaskKeys(tasks: OperationalTaskDto[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(taskKey(task), (counts.get(taskKey(task)) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

function taskSignature(task: OperationalTaskDto) {
  return `${task.kind}:${task.status}:${task.taskDate}`;
}

function pushSample(
  samples: OperationTaskReadComparison["sampleMismatches"],
  dedupeKey: string,
  reason: string,
  legacy?: OperationalTaskDto,
  relational?: OperationalTaskDto
) {
  if (samples.length >= 8) return;
  samples.push({
    dedupeKey,
    reason,
    legacy: legacy ? { kind: legacy.kind, status: legacy.status, taskDate: legacy.taskDate } : undefined,
    relational: relational ? { kind: relational.kind, status: relational.status, taskDate: relational.taskDate } : undefined
  });
}

function legacyTaskId(kind: OperationKind, reservationId: string, taskId: string | null) {
  return taskId ? `${kind}-${reservationId}-${taskId}` : `${kind}-${reservationId}`;
}

function sortTasksByDate(left: OperationalTaskDto, right: OperationalTaskDto) {
  return Date.parse(left.taskDate) - Date.parse(right.taskDate) || left.id.localeCompare(right.id, "ro");
}

function latestDate(values: Date[]) {
  return values.reduce((latest, value) => value > latest ? value : latest, values[0]);
}

function coerceDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
