import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, requirePermission, type AuthSession } from "@/lib/auth";
import { createOperationalTaskRequest } from "@/lib/operational-task-requests";
import { prisma } from "@/lib/prisma";
import { withOperationStatus, withOperationTaskStatus, type OperationKind, type OperationStatus } from "@/lib/operation-status";
import {
  bridgeReservationSelect,
  findOrCreateTaskForLegacyOperation,
  isOperationTaskBridgeUnavailable,
  mirrorOperationTaskStatusToProductionNotes,
  toLegacyOperationResponseDto,
  updateOperationTaskStatus
} from "@/lib/operation-task-bridge";
import type { OperationTaskStatus } from "@/lib/operation-tasks";
import { updateReservationProductionNotesWithClient } from "@/lib/reservations";
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

    const reservation = await updateReservationProductionNotesWithClient(
      prisma,
      id,
      (current) => taskId
        ? withOperationTaskStatus(current.productionNotes, taskId, status as OperationStatus)
        : withOperationStatus(current.productionNotes, kind as OperationKind, status as OperationStatus),
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
  const { session, response } = await requireAnyPermission(request, ["campaigns.operate", "reservations.manage.own"]);
  const headers = { "Cache-Control": "private, no-store" };
  if (response || !session) {
    if (response) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  const { id } = await context.params;
  try {
    return NextResponse.json(await createOperationalTaskRequest(id, await request.json().catch(() => null), session), { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
    const status = [400, 403, 404, 409, 428].includes(code) ? code : 503;
    return NextResponse.json({ error: status === 503 ? "Solicitarea nu poate fi verificată momentan. Reîncearcă aceeași solicitare pentru a verifica rezultatul, fără a crea una nouă." : (error as Error).message }, { status, headers });
  }
}

function operationTasksEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.OPERATION_TASKS_ENABLED || "").toLowerCase());
}

async function updateThroughOperationTaskBridge(
  reservationId: string,
  payload: { kind: OperationKind; status: OperationStatus; taskId: string | null },
  session: AuthSession
) {
  const noTask = new Error("OPERATION_TASK_NOT_APPLICABLE");
  try {
    return await prisma.$transaction(async (tx) => {
      let updatedTask: Awaited<ReturnType<typeof updateOperationTaskStatus>> | null = null;
      const updatedReservation = await updateReservationProductionNotesWithClient(tx, reservationId, async (current) => {
        const task = await findOrCreateTaskForLegacyOperation(current, payload, tx);
        if (!task) throw noTask;
        updatedTask = await updateOperationTaskStatus(task.id, payload.status as OperationTaskStatus, session, tx);
        return mirrorOperationTaskStatusToProductionNotes(current, updatedTask) || "";
      }, session);
      return { reservation: updatedReservation, task: updatedTask! };
    });
  } catch (error) {
    if (error === noTask) return null;
    throw error;
  }
}
