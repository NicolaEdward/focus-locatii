import { prisma } from "@/lib/prisma";
import {
  operationExtraTasks,
  withOperationTask,
  withOperationStatus,
  withOperationTaskStatus,
  type OperationExtraTask,
  type OperationKind,
  type OperationStatus
} from "@/lib/operation-status";
import {
  buildOperationTaskDedupeKey,
  deriveBaseTasksFromReservation,
  parseLegacyOperationTasksForMigration,
  type OperationTaskDraft,
  type OperationTaskKind,
  type OperationTaskReservationLike,
  type OperationTaskStatus
} from "@/lib/operation-tasks";
import type { Prisma } from "@prisma/client";

type OperationTaskBridgeClient = typeof prisma | Prisma.TransactionClient;

export type OperationTaskBridgeReservation = OperationTaskReservationLike & {
  id: string;
  productionNotes?: string | null;
};

export type OperationPayload = {
  kind: OperationKind;
  status: OperationStatus;
  taskId?: string | null;
};

export type OperationTaskRecord = {
  id: string;
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  source: OperationTaskDraft["source"];
  dedupeKey: string | null;
  legacyTaskId: string | null;
  scheduledFor: Date | null;
  completedAt: Date | null;
  cost?: unknown;
  currency: string | null;
  briefUrl: string | null;
  notes: string | null;
  createdByUserId: string | null;
};

export class OperationTaskBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTaskBridgeUnavailableError";
  }
}

export function isOperationTaskBridgeUnavailable(error: unknown) {
  if (error instanceof OperationTaskBridgeUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /portfolio_operation_tasks|OperationTask/i.test(message) && /does not exist|doesn't exist|not exist|unknown table|P2021/i.test(message);
}

export async function ensureTasksForReservation(
  reservationId: string,
  existingReservation?: OperationTaskBridgeReservation,
  client: OperationTaskBridgeClient = prisma
) {
  const reservation = existingReservation || await loadReservationForBridge(reservationId, client);
  if (!reservation) throw new Error("Rezervarea nu exista.");

  const derived = deriveBaseTasksFromReservation(reservation);
  const tasks: OperationTaskRecord[] = [];
  for (const draft of derived.tasks) {
    const task = await findOrCreateTaskDraft(draft, client);
    if (task) tasks.push(task);
  }
  return tasks;
}

export async function findOrCreateTaskForLegacyOperation(
  reservation: OperationTaskBridgeReservation,
  operationPayload: OperationPayload,
  client: OperationTaskBridgeClient = prisma
) {
  if (operationPayload.taskId) {
    const legacyTasks = parseLegacyOperationTasksForMigration(reservation);
    const draft = legacyTasks.tasks.find((task) => task.legacyTaskId === operationPayload.taskId);
    return draft ? findOrCreateTaskDraft(draft, client) : null;
  }

  const kind = operationPayload.kind === "decoration" ? "DECORATION" : "NEUTRALIZATION";
  await ensureTasksForReservation(reservation.id, reservation, client);
  const dedupeKey = buildOperationTaskDedupeKey({ reservationId: reservation.id, kind, variant: "base" });
  if (!dedupeKey) return null;
  return client.operationTask.findUnique({ where: { dedupeKey } }) as Promise<OperationTaskRecord | null>;
}

export async function findOrCreateTaskForLegacyExtraTask(
  reservation: OperationTaskBridgeReservation,
  task: OperationExtraTask,
  client: OperationTaskBridgeClient = prisma
) {
  const mirroredNotes = mirrorOperationTaskCreationToProductionNotes(reservation.productionNotes, task);
  const legacyTasks = parseLegacyOperationTasksForMigration({ ...reservation, productionNotes: mirroredNotes });
  const draft = legacyTasks.tasks.find((item) => item.legacyTaskId === task.id);
  if (!draft) return null;
  const operationTask = await findOrCreateTaskDraft(draft, client);
  return operationTask ? { operationTask, mirroredNotes } : null;
}

export async function updateOperationTaskStatus(
  taskId: string,
  status: OperationTaskStatus,
  _actor?: unknown,
  client: OperationTaskBridgeClient = prisma
) {
  return client.operationTask.update({
    where: { id: taskId },
    data: {
      status,
      ...(status === "DONE" ? { completedAt: new Date() } : {}),
      ...(status === "NEW" || status === "IN_PROGRESS" ? { completedAt: null } : {})
    }
  }) as Promise<OperationTaskRecord>;
}

export function mirrorOperationTaskStatusToProductionNotes(
  reservation: Pick<OperationTaskBridgeReservation, "productionNotes">,
  task: Pick<OperationTaskRecord, "kind" | "status" | "legacyTaskId">
) {
  const status = task.status as OperationStatus;
  if (task.legacyTaskId) {
    return withOperationTaskStatus(reservation.productionNotes, task.legacyTaskId, status);
  }
  const legacyKind = legacyKindForTask(task.kind);
  return legacyKind ? withOperationStatus(reservation.productionNotes, legacyKind, status) : reservation.productionNotes || null;
}

export function toLegacyOperationResponseDto(task: OperationTaskRecord, reservation: OperationTaskBridgeReservation) {
  return {
    id: task.id,
    reservationId: reservation.id,
    taskId: task.legacyTaskId,
    kind: legacyKindForTask(task.kind),
    status: task.status,
    taskDate: task.scheduledFor?.toISOString() || null,
    source: task.source
  };
}

export function mirrorOperationTaskCreationToProductionNotes(value: string | null | undefined, task: OperationExtraTask) {
  const exists = operationExtraTasks(value).some((item) => item.id === task.id);
  return exists ? value || null : withOperationTask(value, task);
}

async function loadReservationForBridge(reservationId: string, client: OperationTaskBridgeClient = prisma) {
  return client.reservation.findUnique({
    where: { id: reservationId },
    select: bridgeReservationSelect
  }) as Promise<OperationTaskBridgeReservation | null>;
}

async function findOrCreateTaskDraft(draft: OperationTaskDraft, client: OperationTaskBridgeClient = prisma) {
  if (!draft.dedupeKey) return null;
  const existing = await client.operationTask.findUnique({ where: { dedupeKey: draft.dedupeKey } });
  if (existing) return existing as OperationTaskRecord;
  return client.operationTask.create({ data: operationTaskCreateData(draft) }) as Promise<OperationTaskRecord>;
}

function operationTaskCreateData(draft: OperationTaskDraft) {
  return {
    reservationId: draft.reservationId,
    campaignId: draft.campaignId,
    locationId: draft.locationId,
    kind: draft.kind,
    status: draft.status,
    source: draft.source,
    dedupeKey: draft.dedupeKey,
    legacyTaskId: draft.legacyTaskId || null,
    scheduledFor: draft.scheduledFor,
    completedAt: draft.completedAt || null,
    assignedToUserId: draft.assignedToUserId || null,
    supplierId: draft.supplierId || null,
    cost: draft.cost ?? null,
    currency: draft.currency || null,
    briefUrl: draft.briefUrl || null,
    beforePhotoUrl: draft.beforePhotoUrl || null,
    afterPhotoUrl: draft.afterPhotoUrl || null,
    notes: draft.notes || null,
    createdByUserId: draft.createdByUserId || null
  };
}

function legacyKindForTask(kind: OperationTaskKind): OperationKind | null {
  if (kind === "DECORATION" || kind === "REDECORATION") return "decoration";
  if (kind === "NEUTRALIZATION") return "neutralization";
  return null;
}

export const bridgeReservationSelect = {
  id: true,
  campaignId: true,
  locationId: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  installationDate: true,
  neutralizationDate: true,
  productionNotes: true
} as const;
