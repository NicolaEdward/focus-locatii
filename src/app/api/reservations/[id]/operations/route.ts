import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission, type AuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withOperationStatus, withOperationTask, withOperationTaskStatus, type OperationKind, type OperationStatus } from "@/lib/operation-status";
import {
  bridgeReservationSelect,
  findOrCreateTaskForLegacyExtraTask,
  findOrCreateTaskForLegacyOperation,
  isOperationTaskBridgeUnavailable,
  mirrorOperationTaskStatusToProductionNotes,
  toLegacyOperationResponseDto,
  updateOperationTaskStatus,
  type OperationTaskBridgeReservation
} from "@/lib/operation-task-bridge";
import type { OperationTaskStatus } from "@/lib/operation-tasks";
import { updateReservationProductionNotes, updateReservationProductionNotesWithClient } from "@/lib/reservations";
import { recordAudit } from "@/lib/audit";
import { emitStructuredLog, safeErrorCode } from "@/lib/observability";

type Context = {
  params: Promise<{ id: string }>;
};

const allowedKinds = new Set(["decoration", "neutralization"]);
const allowedStatuses = new Set(["NEW", "IN_PROGRESS", "DONE", "ARCHIVED"]);

export async function PATCH(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "campaigns.operate");
  if (response || !session) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const kind = String(body?.kind || "");
  const status = String(body?.status || "");
  const taskId = typeof body?.taskId === "string" ? body.taskId : null;

  if (!allowedKinds.has(kind)) {
    return NextResponse.json({ error: "Tip operational invalid." }, { status: 400 });
  }
  if (!allowedStatuses.has(status)) {
    return NextResponse.json({ error: "Status operational invalid." }, { status: 400 });
  }

  const existing = await prisma.reservation.findUnique({
    where: { id },
    select: bridgeReservationSelect
  });

  if (!existing) {
    return NextResponse.json({ error: "Rezervarea nu exista." }, { status: 404 });
  }

  try {
    if (operationTasksEnabled()) {
      try {
        const bridged = await updateThroughOperationTaskBridge(
          id,
          existing,
          { kind: kind as OperationKind, status: status as OperationStatus, taskId },
          session
        );

        if (bridged) {
          await recordAudit({ actor: session, action: `operation.${kind}.${status.toLowerCase()}`, entityType: "reservation", entityId: id, request });
          return NextResponse.json({ reservation: bridged.reservation, task: toLegacyOperationResponseDto(bridged.task, existing) });
        }
      } catch (error) {
        if (isOperationTaskBridgeUnavailable(error)) {
          emitStructuredLog("warn", "operation_task_bridge_unavailable", {
            operation: "operation.status.update",
            role: session.role,
            entityType: "reservation",
            entityId: id,
            errorCode: safeErrorCode(error)
          });
        } else {
          emitStructuredLog("error", "operation_task_bridge_failed", {
            operation: "operation.status.update",
            role: session.role,
            entityType: "reservation",
            entityId: id,
            errorCode: safeErrorCode(error)
          });
          throw error;
        }
      }
    }

    const reservation = await updateReservationProductionNotes(
      id,
      taskId
        ? withOperationTaskStatus(existing.productionNotes, taskId, status as OperationStatus)
        : withOperationStatus(existing.productionNotes, kind as OperationKind, status as OperationStatus),
      session
    );
    await recordAudit({ actor: session, action: `operation.${kind}.${status.toLowerCase()}`, entityType: "reservation", entityId: id, request });

    return NextResponse.json({ reservation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Statusul operational nu a putut fi actualizat.";
    return NextResponse.json({ error: message }, { status: message.includes("proprii") ? 403 : 400 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { session, response } = await requirePermission(request, "campaigns.operate");
  if (response || !session) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const kind = String(body?.kind || "");
  if (!allowedKinds.has(kind)) {
    return NextResponse.json({ error: "Tip operational invalid." }, { status: 400 });
  }

  const taskDate = parseDate(body?.requestedDate || body?.taskDate);
  if (!taskDate) {
    return NextResponse.json({ error: "Data solicitata pentru task este obligatorie." }, { status: 400 });
  }

  const existing = await prisma.reservation.findUnique({
    where: { id },
    select: { ...bridgeReservationSelect, status: true }
  });

  if (!existing) {
    return NextResponse.json({ error: "Inchirierea nu exista." }, { status: 404 });
  }
  if (existing.status !== "BOOKED") {
    return NextResponse.json({ error: "Poti adauga redecorari doar pe inchirieri active." }, { status: 400 });
  }

  const taskId = typeof body?.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : randomUUID();
  const task = {
    id: taskId,
    kind: kind as OperationKind,
    status: "NEW" as OperationStatus,
    taskType: String(body?.taskType || (kind === "decoration" ? "redecoration" : "neutralization")),
    taskDate: taskDate.toISOString(),
    requestedDate: taskDate.toISOString(),
    cost: parseMoney(body?.cost),
    currency: body?.currency === "RON" ? "RON" : body?.currency === "EUR" ? "EUR" : null,
    costOwner: textValue(body?.costOwner),
    note: textValue(body?.note),
    briefUrl: textValue(body?.briefUrl),
    createdByUserId: session.id,
    createdByName: session.name,
    createdAt: new Date().toISOString()
  };

  if (operationTasksEnabled()) {
    try {
      const bridged = await createThroughOperationTaskBridge(id, existing, task, session);
      if (bridged) {
        await recordAudit({ actor: session, action: `operation.${kind}.create_task`, entityType: "reservation", entityId: id, metadata: { task, operationTaskId: bridged.operationTask.id }, request });
        return NextResponse.json({ reservation: bridged.reservation, task });
      }
    } catch (error) {
      if (isOperationTaskBridgeUnavailable(error)) {
        emitStructuredLog("warn", "operation_task_bridge_unavailable", {
          operation: "operation.task.create",
          role: session.role,
          entityType: "reservation",
          entityId: id,
          errorCode: safeErrorCode(error)
        });
      } else {
        emitStructuredLog("error", "operation_task_bridge_failed", {
          operation: "operation.task.create",
          role: session.role,
          entityType: "reservation",
          entityId: id,
          errorCode: safeErrorCode(error)
        });
        const message = error instanceof Error ? error.message : "Taskul operational nu a putut fi creat.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }
  }

  const reservation = await updateReservationProductionNotes(
    id,
    withOperationTask(existing.productionNotes, task),
    session
  );
  await recordAudit({ actor: session, action: `operation.${kind}.create_task`, entityType: "reservation", entityId: id, metadata: { task }, request });

  return NextResponse.json({ reservation, task });
}

function parseDate(value: unknown) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMoney(value: unknown) {
  if (value == null || value === "") return null;
  const amount = Number(String(value).replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function operationTasksEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.OPERATION_TASKS_ENABLED || "").toLowerCase());
}

async function updateThroughOperationTaskBridge(
  reservationId: string,
  reservation: OperationTaskBridgeReservation,
  payload: { kind: OperationKind; status: OperationStatus; taskId: string | null },
  session: AuthSession
) {
  return prisma.$transaction(async (tx) => {
    const task = await findOrCreateTaskForLegacyOperation(reservation, payload, tx);
    if (!task) return null;

    const updatedTask = await updateOperationTaskStatus(task.id, payload.status as OperationTaskStatus, session, tx);
    const mirroredNotes = mirrorOperationTaskStatusToProductionNotes(reservation, updatedTask);
    const updatedReservation = await updateReservationProductionNotesWithClient(tx, reservationId, mirroredNotes || "", session);

    return {
      reservation: updatedReservation,
      task: updatedTask
    };
  });
}

async function createThroughOperationTaskBridge(
  reservationId: string,
  reservation: OperationTaskBridgeReservation,
  task: {
    id: string;
    kind: OperationKind;
    status: OperationStatus;
    taskType: string;
    taskDate: string;
    requestedDate: string;
    cost: number | null;
    currency: string | null;
    costOwner: string | null;
    note: string | null;
    briefUrl: string | null;
    createdByUserId: string | null;
    createdByName: string | null;
    createdAt: string;
  },
  session: AuthSession
) {
  return prisma.$transaction(async (tx) => {
    const bridged = await findOrCreateTaskForLegacyExtraTask(reservation, task, tx);
    if (!bridged) return null;
    const updatedReservation = await updateReservationProductionNotesWithClient(tx, reservationId, bridged.mirroredNotes || "", session);
    return {
      reservation: updatedReservation,
      operationTask: bridged.operationTask
    };
  });
}
