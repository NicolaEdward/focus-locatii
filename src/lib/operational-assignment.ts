import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/lib/auth";
import {
  OPERATIONAL_PROOF_DOCUMENT_TYPE,
  isOperationalProofActive,
  operationalProofDownloadPath,
  parseOperationalProofNotes
} from "@/lib/operational-proof";
import {
  deriveBaseTasksFromReservation,
  parseLegacyOperationTasksForMigration,
  type OperationTaskDraft,
  type OperationTaskKind,
  type OperationTaskStatus
} from "@/lib/operation-tasks";
import { mirrorOperationTaskStatusToProductionNotes } from "@/lib/operation-task-bridge";
import { operationalBusinessOwner } from "@/lib/operational-responsibility";
import { prisma } from "@/lib/prisma";

type OperationalAssignmentClient = typeof prisma | Prisma.TransactionClient;

const MANAGER_ROLES = new Set(["COO", "SUPER_ADMIN"]);
const ACTIVE_TASK_STATUSES = new Set<OperationTaskStatus>(["NEW", "IN_PROGRESS"]);
const FIELD_TASK_KINDS: OperationTaskKind[] = ["DECORATION", "NEUTRALIZATION", "REDECORATION"];
const MAX_ASSIGNMENT_BATCH = 100;

const assignmentReservationSelect = {
  id: true,
  status: true,
  clientId: true,
  campaignId: true,
  locationId: true,
  clientName: true,
  campaignName: true,
  salesperson: true,
  ownerId: true,
  sellerUserId: true,
  periodStart: true,
  periodEnd: true,
  installationDate: true,
  neutralizationDate: true,
  productionNotes: true,
  location: { select: { code: true, city: true, address: true } },
  sellerUser: { select: { name: true } },
  client: {
    select: {
      accountOwnerUserId: true,
      accountOwner: { select: { id: true, name: true } }
    }
  },
  campaign: {
    select: {
      client: {
        select: {
          accountOwnerUserId: true,
          accountOwner: { select: { id: true, name: true } }
        }
      }
    }
  },
  documents: {
    where: { documentType: OPERATIONAL_PROOF_DOCUMENT_TYPE, status: "active" },
    orderBy: { uploadedAt: "desc" as const },
    take: 40,
    select: {
      id: true,
      fileName: true,
      uploadedAt: true,
      expiryDate: true,
      status: true,
      notes: true,
      uploadedBy: { select: { name: true } }
    }
  }
} as const;

type AssignmentReservation = Prisma.ReservationGetPayload<{ select: typeof assignmentReservationSelect }>;

type AssignmentTaskRecord = {
  id: string;
  reservationId: string | null;
  campaignId: string | null;
  locationId: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  source: string;
  dedupeKey: string | null;
  legacyTaskId: string | null;
  scheduledFor: Date | null;
  completedAt: Date | null;
  assignedToUserId: string | null;
  notes: string | null;
  assignedTo: { id: string; name: string; role: string; active: boolean } | null;
};

export type OperationalAssignmentTaskDto = {
  taskKey: string;
  operationTaskId: string | null;
  reservationId: string;
  legacyTaskId: string | null;
  kind: OperationTaskKind;
  status: OperationTaskStatus;
  scheduledFor: string;
  completedAt: string | null;
  businessOwner: { id: string; name: string } | null;
  assignedTo: { id: string; name: string } | null;
  location: { code: string; city: string | null; address: string | null };
  clientName: string;
  campaignName: string | null;
  salesperson: string;
  periodStart: string;
  periodEnd: string;
  source: "relational" | "derived";
  overdue: boolean;
  proofPhotos: Array<{
    id: string;
    fileName: string;
    uploadedAt: string;
    expiryDate: string | null;
    uploadedBy: string;
    downloadUrl: string;
  }>;
};

export type OperationalAssignmentDryRun = {
  batchId: string;
  assignee: { id: string; name: string };
  selectedCount: number;
  changeCount: number;
  createCount: number;
  reassignCount: number;
  unchangedCount: number;
  blocked: Array<{ taskKey: string; reason: string }>;
  items: Array<{
    taskKey: string;
    reservationId: string;
    operationTaskId: string | null;
    kind: OperationTaskKind;
    scheduledFor: string;
    beforeAssigneeUserId: string | null;
    afterAssigneeUserId: string;
  }>;
};

export function operationalAssignmentEnabled(env: NodeJS.ProcessEnv = process.env) {
  return ["1", "true", "yes"].includes(String(env.OPERATIONAL_ASSIGNMENT_ENABLED || "").toLowerCase());
}

export function isOperationalAssignmentManager(session: Pick<AuthSession, "role">) {
  return MANAGER_ROLES.has(session.role);
}

export async function listFieldOperators(client: OperationalAssignmentClient = prisma) {
  return client.user.findMany({
    where: { role: "FIELD_OPERATOR", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
}

export async function listOperationalAssignmentTasks(input: {
  session: AuthSession;
  includeCompleted?: boolean;
  client?: OperationalAssignmentClient;
}) {
  assertAssignmentEnabled();
  const client = input.client || prisma;
  if (input.session.role === "FIELD_OPERATOR") {
    return listAssignedFieldTasks(input.session.id, Boolean(input.includeCompleted), client);
  }
  if (!isOperationalAssignmentManager(input.session)) return [];
  return listManagerAssignmentTasks(Boolean(input.includeCompleted), client);
}

export async function buildOperationalAssignmentDryRun(input: {
  taskKeys: string[];
  assigneeUserId: string;
  session: AuthSession;
  client?: OperationalAssignmentClient;
}): Promise<OperationalAssignmentDryRun> {
  assertAssignmentEnabled();
  assertManager(input.session);
  const client = input.client || prisma;
  const taskKeys = uniqueTaskKeys(input.taskKeys);
  if (!taskKeys.length) throw new Error("Selecteaza cel putin o lucrare.");
  if (taskKeys.length > MAX_ASSIGNMENT_BATCH) throw new Error(`Un batch poate contine maximum ${MAX_ASSIGNMENT_BATCH} lucrari.`);

  const assignee = await client.user.findFirst({
    where: { id: input.assigneeUserId, role: "FIELD_OPERATOR", active: true },
    select: { id: true, name: true }
  });
  if (!assignee) throw new Error("Executorul de teren nu este activ sau nu are rol Field Operator.");

  const tasks = await listManagerAssignmentTasks(true, client);
  const tasksByKey = new Map(tasks.map((task) => [task.taskKey, task]));
  const blocked: OperationalAssignmentDryRun["blocked"] = [];
  const items: OperationalAssignmentDryRun["items"] = [];
  let unchangedCount = 0;

  for (const taskKey of taskKeys) {
    const task = tasksByKey.get(taskKey);
    if (!task) {
      blocked.push({ taskKey, reason: "Lucrarea nu mai provine dintr-o rezervare BOOKED activa." });
      continue;
    }
    if (!ACTIVE_TASK_STATUSES.has(task.status)) {
      blocked.push({ taskKey, reason: "Doar lucrarile active pot fi atribuite." });
      continue;
    }
    if (task.assignedTo?.id === assignee.id) {
      unchangedCount += 1;
      continue;
    }
    items.push({
      taskKey,
      reservationId: task.reservationId,
      operationTaskId: task.operationTaskId,
      kind: task.kind,
      scheduledFor: task.scheduledFor,
      beforeAssigneeUserId: task.assignedTo?.id || null,
      afterAssigneeUserId: assignee.id
    });
  }

  const batchId = assignmentBatchId({ assigneeUserId: assignee.id, selectedTaskKeys: taskKeys, items, blocked });
  return {
    batchId,
    assignee,
    selectedCount: taskKeys.length,
    changeCount: items.length,
    createCount: items.filter((item) => !item.operationTaskId).length,
    reassignCount: items.filter((item) => item.operationTaskId && item.beforeAssigneeUserId).length,
    unchangedCount,
    blocked,
    items
  };
}

export async function applyOperationalAssignmentBatch(input: {
  taskKeys: string[];
  assigneeUserId: string;
  expectedBatchId: string;
  reason: string;
  session: AuthSession;
}) {
  assertAssignmentEnabled();
  assertManager(input.session);
  if (input.reason.trim().length < 10) throw new Error("Motivul atribuirii trebuie sa aiba cel putin 10 caractere.");

  const prior = await prisma.auditLog.findFirst({
    where: { action: "operation.assignment.batch_applied", entityType: "operation_assignment_batch", entityId: input.expectedBatchId },
    select: { id: true }
  });
  if (prior) return {
    batchId: input.expectedBatchId,
    updated: 0,
    idempotent: true,
    taskIds: [] as string[],
    previousAssigneeUserIds: [] as string[]
  };

  const dryRun = await buildOperationalAssignmentDryRun({
    taskKeys: input.taskKeys,
    assigneeUserId: input.assigneeUserId,
    session: input.session
  });
  if (dryRun.batchId !== input.expectedBatchId) throw new Error("Datele s-au schimbat dupa dry-run. Verifica din nou impactul.");
  if (dryRun.blocked.length) throw new Error("Batch-ul contine lucrari blocate si nu poate fi aplicat.");
  if (!dryRun.items.length) return {
    batchId: dryRun.batchId,
    updated: 0,
    idempotent: true,
    taskIds: [] as string[],
    previousAssigneeUserIds: [] as string[]
  };

  const result = await prisma.$transaction(async (tx) => {
    const existingBatch = await tx.auditLog.findFirst({
      where: { action: "operation.assignment.batch_applied", entityType: "operation_assignment_batch", entityId: dryRun.batchId },
      select: { id: true }
    });
    if (existingBatch) return {
      batchId: dryRun.batchId,
      updated: 0,
      idempotent: true,
      taskIds: [] as string[],
      previousAssigneeUserIds: [] as string[]
    };

    const taskIds: string[] = [];
    for (const item of dryRun.items) {
      const draft = await loadCurrentDraft(item.taskKey, tx);
      if (!draft || !draft.dedupeKey) throw new Error(`Lucrarea ${item.taskKey} nu mai este eligibila.`);
      const existing = await tx.operationTask.findUnique({ where: { dedupeKey: item.taskKey } });
      if ((existing?.assignedToUserId || null) !== item.beforeAssigneeUserId) {
        throw new Error(`Executorul lucrarii ${item.taskKey} s-a schimbat dupa dry-run.`);
      }
      let task;
      if (existing) {
        const updated = await tx.operationTask.updateMany({
          where: { id: existing.id, assignedToUserId: item.beforeAssigneeUserId },
          data: assignmentTaskSyncData(draft, input.assigneeUserId)
        });
        if (updated.count !== 1) {
          throw new Error(`Executorul lucrarii ${item.taskKey} s-a schimbat in timpul aplicarii.`);
        }
        task = await tx.operationTask.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        task = await tx.operationTask.create({
          data: {
            ...assignmentTaskCreateData(draft, input.session.id),
            assignedToUserId: input.assigneeUserId
          }
        });
      }
      taskIds.push(task.id);
      await tx.auditLog.create({
        data: {
          userId: input.session.id,
          action: item.beforeAssigneeUserId ? "operation.assignment.reassigned" : "operation.assignment.assigned",
          entityType: "operation_task",
          entityId: task.id,
          metadata: jsonMetadata({
            batchId: dryRun.batchId,
            reason: input.reason.trim(),
            reservationId: item.reservationId,
            taskKey: item.taskKey,
            before: { assignedToUserId: item.beforeAssigneeUserId },
            after: { assignedToUserId: input.assigneeUserId }
          })
        }
      });
    }
    await tx.auditLog.create({
      data: {
        userId: input.session.id,
        action: "operation.assignment.batch_applied",
        entityType: "operation_assignment_batch",
        entityId: dryRun.batchId,
        metadata: jsonMetadata({
          reason: input.reason.trim(),
          assigneeUserId: input.assigneeUserId,
          taskIds,
          taskKeys: dryRun.items.map((item) => item.taskKey),
          updated: taskIds.length
        })
      }
    });
    return {
      batchId: dryRun.batchId,
      updated: taskIds.length,
      idempotent: false,
      taskIds,
      previousAssigneeUserIds: [...new Set(dryRun.items.map((item) => item.beforeAssigneeUserId).filter(Boolean) as string[])]
    };
  }, { maxWait: 10_000, timeout: 30_000 });

  return result;
}

export async function updateAssignedOperationalTaskStatus(input: {
  operationTaskId: string;
  status: "NEW" | "IN_PROGRESS";
  session: AuthSession;
}) {
  assertAssignmentEnabled();
  const task = await getOperationalTaskForAccess(input.operationTaskId, input.session);
  if (!task) throw new Error("Lucrarea nu exista sau nu este atribuita acestui utilizator.");
  if (task.reservation?.status !== "BOOKED") throw new Error("Doar lucrarile BOOKED pot fi operate pe teren.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.operationTask.update({
      where: { id: task.id },
      data: { status: input.status, completedAt: null }
    });
    const mirroredNotes = mirrorOperationTaskStatusToProductionNotes(
      { productionNotes: task.reservation?.productionNotes || null },
      { kind: task.kind, status: input.status, legacyTaskId: task.legacyTaskId }
    );
    await tx.reservation.update({ where: { id: String(task.reservationId) }, data: { productionNotes: mirroredNotes } });
    await tx.auditLog.create({
      data: {
        userId: input.session.id,
        action: "operation.task.status_changed",
        entityType: "operation_task",
        entityId: task.id,
        metadata: jsonMetadata({ before: { status: task.status }, after: { status: input.status }, reservationId: task.reservationId })
      }
    });
    return updated;
  });
}

export async function getOperationalTaskForAccess(operationTaskId: string, session: AuthSession, client: OperationalAssignmentClient = prisma) {
  if (!operationalAssignmentEnabled()) return null;
  const task = await client.operationTask.findUnique({
    where: { id: operationTaskId },
    include: {
      campaign: {
        select: {
          client: { select: { accountOwnerUserId: true } }
        }
      },
      reservation: {
        select: {
          id: true,
          status: true,
          productionNotes: true,
          client: { select: { accountOwnerUserId: true } },
          campaign: {
            select: {
              client: { select: { accountOwnerUserId: true } }
            }
          }
        }
      }
    }
  });
  if (!task || !task.reservation || task.reservation.status !== "BOOKED") return null;
  if (session.role === "FIELD_OPERATOR") return task.assignedToUserId === session.id ? task : null;
  if (isOperationalAssignmentManager(session)) return task;
  if (session.role === "SALES_DIRECTOR") return task;
  if (session.role !== "SALES_AGENT") return null;
  return operationalBusinessOwner(task)?.id === session.id ? task : null;
}

export async function findOperationalTaskForWork(input: {
  reservationId: string;
  kind: "decoration" | "neutralization";
  legacyTaskId?: string | null;
  operationTaskId?: string | null;
  client?: OperationalAssignmentClient;
}) {
  const client = input.client || prisma;
  if (input.operationTaskId) {
    return client.operationTask.findUnique({ where: { id: input.operationTaskId } });
  }
  if (input.legacyTaskId) {
    return client.operationTask.findFirst({
      where: { reservationId: input.reservationId, legacyTaskId: input.legacyTaskId, kind: { in: FIELD_TASK_KINDS } }
    });
  }
  return client.operationTask.findUnique({
    where: { dedupeKey: `reservation:${input.reservationId}:${input.kind === "decoration" ? "DECORATION" : "NEUTRALIZATION"}:base` }
  });
}

export async function fieldCanAccessOperationalProof(input: {
  session: AuthSession;
  reservationId: string;
  kind: "decoration" | "neutralization";
  legacyTaskId?: string | null;
}) {
  if (input.session.role !== "FIELD_OPERATOR" || !operationalAssignmentEnabled()) return false;
  const task = await findOperationalTaskForWork({
    reservationId: input.reservationId,
    kind: input.kind,
    legacyTaskId: input.legacyTaskId
  });
  if (!task || task.assignedToUserId !== input.session.id) return false;
  const reservation = await prisma.reservation.findUnique({ where: { id: input.reservationId }, select: { status: true } });
  return reservation?.status === "BOOKED";
}

export function assignmentBatchId(input: unknown) {
  return `opasg_${crypto.createHash("sha256").update(stableJson(input)).digest("hex").slice(0, 20)}`;
}

function assertAssignmentEnabled() {
  if (!operationalAssignmentEnabled()) throw new Error("Pilotul de assignment operational nu este activ.");
}

function assertManager(session: Pick<AuthSession, "role">) {
  if (!isOperationalAssignmentManager(session)) throw new Error("Doar COO sau administratorul pot atribui lucrari de teren.");
}

async function listManagerAssignmentTasks(includeCompleted: boolean, client: OperationalAssignmentClient) {
  const reservations = await client.reservation.findMany({
    where: { status: "BOOKED" },
    select: assignmentReservationSelect,
    orderBy: [{ periodStart: "asc" }, { id: "asc" }],
    take: 1000
  });
  if (!reservations.length) return [];
  const taskRows = await client.operationTask.findMany({
    where: { reservationId: { in: reservations.map((reservation) => reservation.id) }, kind: { in: FIELD_TASK_KINDS } },
    include: { assignedTo: { select: { id: true, name: true, role: true, active: true } } }
  }) as AssignmentTaskRecord[];
  return mergeAssignmentTasks(reservations, taskRows, includeCompleted);
}

async function listAssignedFieldTasks(userId: string, includeCompleted: boolean, client: OperationalAssignmentClient) {
  const completedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const taskRows = await client.operationTask.findMany({
    where: {
      assignedToUserId: userId,
      kind: { in: FIELD_TASK_KINDS },
      reservation: { status: "BOOKED" },
      ...(includeCompleted
        ? { OR: [{ status: { in: ["NEW", "IN_PROGRESS"] } }, { status: "DONE", completedAt: { gte: completedAfter } }] }
        : { status: { in: ["NEW", "IN_PROGRESS"] } })
    },
    include: {
      assignedTo: { select: { id: true, name: true, role: true, active: true } },
      reservation: { select: assignmentReservationSelect }
    },
    orderBy: [{ scheduledFor: "asc" }, { id: "asc" }]
  }) as Array<AssignmentTaskRecord & { reservation: AssignmentReservation }>;
  return taskRows.flatMap((task) => {
    const draft = currentDrafts(task.reservation).find((item) => item.dedupeKey === task.dedupeKey);
    if (!draft) return [];
    return [toAssignmentTaskDto(task.reservation, draft, task)];
  });
}

function mergeAssignmentTasks(reservations: AssignmentReservation[], tasks: AssignmentTaskRecord[], includeCompleted: boolean) {
  const tasksByKey = new Map(tasks.filter((task) => task.dedupeKey).map((task) => [String(task.dedupeKey), task]));
  return reservations.flatMap((reservation) => currentDrafts(reservation).flatMap((draft) => {
    if (!draft.dedupeKey || !draft.scheduledFor) return [];
    const relational = tasksByKey.get(draft.dedupeKey) || null;
    const effectiveStatus = relational?.assignedToUserId ? relational.status : draft.status;
    if (!includeCompleted && !ACTIVE_TASK_STATUSES.has(effectiveStatus)) return [];
    return [toAssignmentTaskDto(reservation, { ...draft, status: effectiveStatus }, relational)];
  })).sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor) || left.taskKey.localeCompare(right.taskKey));
}

function toAssignmentTaskDto(reservation: AssignmentReservation, draft: OperationTaskDraft, relational: AssignmentTaskRecord | null): OperationalAssignmentTaskDto {
  const scheduledFor = relational?.assignedToUserId && relational.scheduledFor ? relational.scheduledFor : draft.scheduledFor;
  const status = relational?.assignedToUserId ? relational.status : draft.status;
  const businessOwner = operationalBusinessOwner({ reservation });
  const proofPhotos = reservation.documents.flatMap((document) => {
    if (!isOperationalProofActive(document)) return [];
    const notes = parseOperationalProofNotes(document.notes);
    if (!notes || notes.kind !== operationKind(draft.kind) || (notes.taskId || null) !== (draft.legacyTaskId || null)) return [];
    return [{
      id: document.id,
      fileName: document.fileName,
      uploadedAt: document.uploadedAt.toISOString(),
      expiryDate: document.expiryDate?.toISOString() || null,
      uploadedBy: document.uploadedBy?.name || "Utilizator",
      downloadUrl: operationalProofDownloadPath(document.id)
    }];
  });
  return {
    taskKey: String(draft.dedupeKey),
    operationTaskId: relational?.id || null,
    reservationId: reservation.id,
    legacyTaskId: draft.legacyTaskId || null,
    kind: draft.kind,
    status,
    scheduledFor: scheduledFor?.toISOString() || "",
    completedAt: relational?.completedAt?.toISOString() || draft.completedAt?.toISOString() || null,
    businessOwner: businessOwner ? { id: businessOwner.id, name: businessOwner.name || "Vanzator alocat" } : null,
    assignedTo: relational?.assignedTo ? { id: relational.assignedTo.id, name: relational.assignedTo.name } : null,
    location: {
      code: reservation.location.code,
      city: reservation.location.city,
      address: reservation.location.address
    },
    clientName: reservation.clientName,
    campaignName: reservation.campaignName,
    salesperson: businessOwner?.name || "Nealocat",
    periodStart: reservation.periodStart.toISOString(),
    periodEnd: reservation.periodEnd.toISOString(),
    source: relational ? "relational" : "derived",
    overdue: ACTIVE_TASK_STATUSES.has(status) && Boolean(scheduledFor && scheduledFor.getTime() < Date.now()),
    proofPhotos
  };
}

function currentDrafts(reservation: AssignmentReservation) {
  return [
    ...deriveBaseTasksFromReservation(reservation).tasks,
    ...parseLegacyOperationTasksForMigration(reservation).tasks
  ].filter((task) => task.dedupeKey && task.scheduledFor);
}

async function loadCurrentDraft(taskKey: string, client: OperationalAssignmentClient) {
  const existing = await client.operationTask.findUnique({ where: { dedupeKey: taskKey }, select: { reservationId: true } });
  const reservationId = existing?.reservationId || reservationIdFromTaskKey(taskKey);
  if (!reservationId) return null;
  const reservation = await client.reservation.findUnique({ where: { id: reservationId }, select: assignmentReservationSelect });
  if (!reservation || reservation.status !== "BOOKED") return null;
  return currentDrafts(reservation).find((task) => task.dedupeKey === taskKey) || null;
}

function reservationIdFromTaskKey(taskKey: string) {
  const match = taskKey.match(/^reservation:([^:]+):/);
  return match?.[1] || null;
}

function assignmentTaskSyncData(draft: OperationTaskDraft, assigneeUserId: string) {
  return {
    reservationId: draft.reservationId,
    campaignId: draft.campaignId,
    locationId: draft.locationId,
    kind: draft.kind,
    status: draft.status,
    source: draft.source,
    legacyTaskId: draft.legacyTaskId || null,
    scheduledFor: draft.scheduledFor,
    completedAt: draft.completedAt || null,
    assignedToUserId: assigneeUserId
  };
}

function assignmentTaskCreateData(draft: OperationTaskDraft, actorId: string) {
  return {
    ...assignmentTaskSyncData(draft, draft.assignedToUserId || ""),
    assignedToUserId: draft.assignedToUserId || null,
    dedupeKey: String(draft.dedupeKey),
    supplierId: draft.supplierId || null,
    cost: draft.cost ?? null,
    currency: draft.currency || null,
    briefUrl: draft.briefUrl || null,
    beforePhotoUrl: draft.beforePhotoUrl || null,
    afterPhotoUrl: draft.afterPhotoUrl || null,
    notes: draft.notes || null,
    createdByUserId: actorId
  };
}

function operationKind(kind: OperationTaskKind) {
  return kind === "NEUTRALIZATION" ? "neutralization" : "decoration";
}

function uniqueTaskKeys(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonMetadata(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
