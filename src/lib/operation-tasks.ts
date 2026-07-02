import {
  parseOperationMeta,
  type OperationExtraTask,
  type OperationStatus as LegacyOperationStatus
} from "./operation-status";

export const OPERATION_TASK_KINDS = ["DECORATION", "NEUTRALIZATION", "REDECORATION", "MAINTENANCE"] as const;
export const OPERATION_TASK_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "ARCHIVED", "CANCELLED"] as const;
export const OPERATION_TASK_SOURCES = ["SYSTEM_DERIVED", "LEGACY_PRODUCTION_NOTES", "MANUAL"] as const;

export type OperationTaskKind = (typeof OPERATION_TASK_KINDS)[number];
export type OperationTaskStatus = (typeof OPERATION_TASK_STATUSES)[number];
export type OperationTaskSource = (typeof OPERATION_TASK_SOURCES)[number];

export type OperationTaskIssue = {
  code: string;
  message: string;
  reservationId?: string | null;
  legacyTaskId?: string | null;
  kind?: OperationTaskKind | null;
  field?: string;
};

export type OperationTaskDraft = {
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  source: OperationTaskSource;
  dedupeKey: string | null;
  legacyTaskId?: string | null;
  scheduledFor: Date | null;
  completedAt?: Date | null;
  assignedToUserId?: string | null;
  supplierId?: string | null;
  cost?: number | null;
  currency?: string | null;
  briefUrl?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
};

export type OperationTaskDerivationResult = {
  tasks: OperationTaskDraft[];
  issues: OperationTaskIssue[];
};

export type OperationTaskReservationLike = {
  id?: string | null;
  campaignId?: string | null;
  locationId?: string | null;
  status?: string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  installationDate?: Date | string | null;
  neutralizationDate?: Date | string | null;
  productionNotes?: string | null;
};

export type OperationTaskDedupeInput = {
  reservationId?: string | null;
  kind: OperationTaskKind;
  legacyTaskId?: string | null;
  variant?: "base" | "legacy-extra";
};

type LegacyMetaRead = {
  meta: ReturnType<typeof parseOperationMeta>;
  raw: Record<string, unknown> | null;
  issues: OperationTaskIssue[];
};

const LEGACY_META_PATTERN = /<!--focus-ops:([\s\S]*?)-->/;
const BASE_TASK_KINDS = new Set<OperationTaskKind>(["DECORATION", "NEUTRALIZATION"]);
const RESERVATION_REQUIRED_KINDS = new Set<OperationTaskKind>(["DECORATION", "NEUTRALIZATION", "REDECORATION"]);

export function buildOperationTaskDedupeKey(input: OperationTaskDedupeInput) {
  const reservationId = textValue(input.reservationId);
  if (!reservationId) return null;

  const legacyTaskId = textValue(input.legacyTaskId);
  if (input.variant === "legacy-extra" || legacyTaskId) {
    return legacyTaskId ? `reservation:${reservationId}:legacy-extra:${legacyTaskId}` : null;
  }

  if (input.variant === "base" || BASE_TASK_KINDS.has(input.kind)) {
    return `reservation:${reservationId}:${input.kind}:base`;
  }

  return null;
}

export function toOperationTaskStatus(status: unknown): OperationTaskStatus | null {
  return OPERATION_TASK_STATUSES.includes(String(status) as OperationTaskStatus)
    ? String(status) as OperationTaskStatus
    : null;
}

export function normalizeLegacyOperationStatus(status: unknown): { status: OperationTaskStatus; issue: OperationTaskIssue | null } {
  const mapped = toOperationTaskStatus(status);
  if (mapped) return { status: mapped, issue: null };
  return {
    status: "NEW",
    issue: {
      code: "ambiguous_legacy_status",
      message: `Legacy operation status "${String(status)}" is not recognized; defaulted to NEW.`,
      field: "status"
    }
  };
}

export function deriveBaseTasksFromReservation(reservation: OperationTaskReservationLike): OperationTaskDerivationResult {
  const reservationId = textValue(reservation.id);
  const issues: OperationTaskIssue[] = [];
  if (hasExplicitNonBookedStatus(reservation)) return { tasks: [], issues };

  const legacy = readLegacyMeta(reservation.productionNotes, reservationId);
  issues.push(...legacy.issues);

  addRawStatusIssues(legacy.raw, reservationId, issues);

  const tasks: OperationTaskDraft[] = [];
  const decorationDate = coerceDate(reservation.installationDate) || coerceDate(reservation.periodStart);
  const neutralizationDate = coerceDate(reservation.neutralizationDate) || coerceDate(reservation.periodEnd);

  if (reservationId && decorationDate) {
    const status = normalizeLegacyOperationStatus(legacy.meta.decorationStatus || "NEW").status;
    tasks.push({
      reservationId,
      campaignId: textValue(reservation.campaignId),
      locationId: textValue(reservation.locationId),
      kind: "DECORATION",
      status,
      source: "SYSTEM_DERIVED",
      dedupeKey: buildOperationTaskDedupeKey({ reservationId, kind: "DECORATION", variant: "base" }),
      scheduledFor: decorationDate,
      completedAt: status === "DONE" ? coerceDate(legacy.meta.decorationUpdatedAt) : null
    });
  } else {
    issues.push({
      code: "missing_decoration_base_data",
      message: "Decoration base task could not be derived because reservationId or scheduled date is missing.",
      reservationId,
      kind: "DECORATION",
      field: reservationId ? "scheduledFor" : "reservationId"
    });
  }

  if (reservationId && neutralizationDate) {
    const status = normalizeLegacyOperationStatus(legacy.meta.neutralizationStatus || "NEW").status;
    tasks.push({
      reservationId,
      campaignId: textValue(reservation.campaignId),
      locationId: textValue(reservation.locationId),
      kind: "NEUTRALIZATION",
      status,
      source: "SYSTEM_DERIVED",
      dedupeKey: buildOperationTaskDedupeKey({ reservationId, kind: "NEUTRALIZATION", variant: "base" }),
      scheduledFor: neutralizationDate,
      completedAt: status === "DONE" ? coerceDate(legacy.meta.neutralizationUpdatedAt) : null
    });
  } else {
    issues.push({
      code: "missing_neutralization_base_data",
      message: "Neutralization base task could not be derived because reservationId or scheduled date is missing.",
      reservationId,
      kind: "NEUTRALIZATION",
      field: reservationId ? "scheduledFor" : "reservationId"
    });
  }

  const deduped = dedupeOperationTaskDrafts(tasks);
  return { tasks: deduped.tasks, issues: [...issues, ...deduped.issues] };
}

export function parseLegacyOperationTasksForMigration(reservation: OperationTaskReservationLike): OperationTaskDerivationResult {
  const reservationId = textValue(reservation.id);
  const issues: OperationTaskIssue[] = [];
  if (hasExplicitNonBookedStatus(reservation)) return { tasks: [], issues };

  const legacy = readLegacyMeta(reservation.productionNotes, reservationId);
  issues.push(...legacy.issues);

  if (!reservationId) {
    issues.push({
      code: "missing_reservation_id",
      message: "Legacy operation tasks require reservationId during migration.",
      reservationId,
      field: "reservationId"
    });
    return { tasks: [], issues };
  }

  const tasks = (legacy.meta.tasks || []).flatMap((task) => legacyExtraTaskToDraft(task, reservation, reservationId, issues));
  const deduped = dedupeOperationTaskDrafts(tasks);
  return { tasks: deduped.tasks, issues: [...issues, ...deduped.issues] };
}

export function validateOperationTaskInput(input: {
  kind?: unknown;
  status?: unknown;
  reservationId?: unknown;
  locationId?: unknown;
  scheduledFor?: unknown;
}): { valid: boolean; issues: OperationTaskIssue[] } {
  const issues: OperationTaskIssue[] = [];
  const kind = OPERATION_TASK_KINDS.includes(String(input.kind) as OperationTaskKind)
    ? String(input.kind) as OperationTaskKind
    : null;

  if (!kind) {
    issues.push({
      code: "invalid_kind",
      message: "Operation task kind is invalid.",
      kind: null,
      field: "kind"
    });
  }

  if (input.status !== undefined && !toOperationTaskStatus(input.status)) {
    issues.push({
      code: "invalid_status",
      message: "Operation task status is invalid.",
      kind,
      field: "status"
    });
  }

  const reservationId = textValue(input.reservationId);
  const locationId = textValue(input.locationId);
  if (kind && RESERVATION_REQUIRED_KINDS.has(kind) && !reservationId) {
    issues.push({
      code: "missing_reservation_id",
      message: `${kind} tasks require reservationId in phase one.`,
      kind,
      field: "reservationId"
    });
  }

  if (kind === "MAINTENANCE" && !reservationId && !locationId) {
    issues.push({
      code: "missing_task_scope",
      message: "MAINTENANCE tasks require reservationId or locationId.",
      kind,
      field: "locationId"
    });
  }

  if (input.scheduledFor !== undefined && input.scheduledFor !== null && !coerceDate(input.scheduledFor)) {
    issues.push({
      code: "invalid_scheduled_for",
      message: "Operation task scheduledFor is invalid.",
      kind,
      field: "scheduledFor"
    });
  }

  return { valid: issues.length === 0, issues };
}

export function dedupeOperationTaskDrafts(tasks: OperationTaskDraft[]): OperationTaskDerivationResult {
  const seen = new Set<string>();
  const deduped: OperationTaskDraft[] = [];
  const issues: OperationTaskIssue[] = [];

  for (const task of tasks) {
    if (!task.dedupeKey) {
      deduped.push(task);
      continue;
    }
    if (seen.has(task.dedupeKey)) {
      issues.push({
        code: "duplicate_dedupe_key",
        message: `Duplicate operation task dedupe key skipped: ${task.dedupeKey}.`,
        reservationId: task.reservationId,
        legacyTaskId: task.legacyTaskId,
        kind: task.kind,
        field: "dedupeKey"
      });
      continue;
    }
    seen.add(task.dedupeKey);
    deduped.push(task);
  }

  return { tasks: deduped, issues };
}

function legacyExtraTaskToDraft(
  task: OperationExtraTask,
  reservation: OperationTaskReservationLike,
  reservationId: string,
  issues: OperationTaskIssue[]
): OperationTaskDraft[] {
  const scheduledFor = coerceDate(task.taskDate || task.requestedDate);
  if (!scheduledFor) {
    issues.push({
      code: "missing_legacy_task_date",
      message: "Legacy operation task has no usable task date.",
      reservationId,
      legacyTaskId: task.id,
      field: "scheduledFor"
    });
    return [];
  }

  const kind = legacyExtraTaskKind(task, reservationId, issues);
  const status = normalizeLegacyOperationStatus(task.status as LegacyOperationStatus).status;
  return [{
    reservationId,
    campaignId: textValue(reservation.campaignId),
    locationId: textValue(reservation.locationId),
    kind,
    status,
    source: "LEGACY_PRODUCTION_NOTES",
    dedupeKey: buildOperationTaskDedupeKey({
      reservationId,
      kind,
      legacyTaskId: task.id,
      variant: "legacy-extra"
    }),
    legacyTaskId: task.id,
    scheduledFor,
    completedAt: null,
    cost: typeof task.cost === "number" && Number.isFinite(task.cost) ? task.cost : null,
    currency: textValue(task.currency),
    briefUrl: textValue(task.briefUrl),
    notes: textValue(task.note),
    createdByUserId: textValue(task.createdByUserId)
  }];
}

function legacyExtraTaskKind(task: OperationExtraTask, reservationId: string, issues: OperationTaskIssue[]): OperationTaskKind {
  if (task.kind === "decoration" && task.taskType === "redecoration") return "REDECORATION";
  if (task.kind === "neutralization") return "NEUTRALIZATION";
  if (task.kind === "decoration") {
    issues.push({
      code: "ambiguous_legacy_task_type",
      message: `Legacy decoration task "${task.id}" is not explicitly redecoration; mapped to DECORATION.`,
      reservationId,
      legacyTaskId: task.id,
      kind: "DECORATION",
      field: "taskType"
    });
    return "DECORATION";
  }
  return "MAINTENANCE";
}

function readLegacyMeta(value: string | null | undefined, reservationId: string | null): LegacyMetaRead {
  const issues: OperationTaskIssue[] = [];
  const raw = readRawLegacyMeta(value, reservationId, issues);
  return {
    meta: parseOperationMeta(value),
    raw,
    issues
  };
}

function readRawLegacyMeta(value: string | null | undefined, reservationId: string | null, issues: OperationTaskIssue[]) {
  const match = String(value || "").match(LEGACY_META_PATTERN);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    issues.push({
      code: "corrupted_legacy_metadata",
      message: "Legacy productionNotes operation metadata could not be parsed.",
      reservationId,
      field: "productionNotes"
    });
    return null;
  }
}

function addRawStatusIssues(raw: Record<string, unknown> | null, reservationId: string | null, issues: OperationTaskIssue[]) {
  for (const [field, kind] of [
    ["decorationStatus", "DECORATION"],
    ["neutralizationStatus", "NEUTRALIZATION"]
  ] as const) {
    if (raw?.[field] !== undefined && !toOperationTaskStatus(raw[field])) {
      issues.push({
        ...normalizeLegacyOperationStatus(raw[field]).issue,
        reservationId,
        kind,
        field
      } as OperationTaskIssue);
    }
  }
}

function coerceDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function hasExplicitNonBookedStatus(reservation: OperationTaskReservationLike) {
  return reservation.status != null && reservation.status !== "BOOKED";
}
