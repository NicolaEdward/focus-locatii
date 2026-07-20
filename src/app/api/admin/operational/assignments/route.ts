import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { createOperationalNotifications } from "@/lib/notifications";
import { emitStructuredLog, safeErrorCode } from "@/lib/observability";
import {
  applyOperationalAssignmentBatch,
  buildOperationalAssignmentDryRun,
  operationalAssignmentEnabled
} from "@/lib/operational-assignment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };
const confirmation = "ATRIBUIE TASKURILE OPERATIONALE";

export async function POST(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "campaigns.operate"]);
  if (response || !session) return response;
  if (!operationalAssignmentEnabled()) {
    return NextResponse.json({ error: "Pilotul de assignment operational nu este activ." }, { status: 404, headers: noStoreHeaders });
  }

  try {
    const body = await request.json().catch(() => null);
    const command = textValue(body?.command);
    const taskKeys = Array.isArray(body?.taskKeys) ? body.taskKeys.map(String) : [];
    const assigneeUserId = textValue(body?.assigneeUserId);
    if (!assigneeUserId) {
      return NextResponse.json({ error: "Alege responsabilul de teren." }, { status: 400, headers: noStoreHeaders });
    }
    if (command === "dry-run") {
      const dryRun = await buildOperationalAssignmentDryRun({ taskKeys, assigneeUserId, session });
      return NextResponse.json({ dryRun }, { headers: noStoreHeaders });
    }
    if (command !== "apply" || body?.confirmation !== confirmation) {
      return NextResponse.json({ error: "Confirmarea batch-ului lipseste." }, { status: 400, headers: noStoreHeaders });
    }
    const result = await applyOperationalAssignmentBatch({
      taskKeys,
      assigneeUserId,
      expectedBatchId: textValue(body?.expectedBatchId) || "",
      reason: textValue(body?.reason) || "",
      session
    });
    if (result.updated > 0) {
      try {
        await createOperationalNotifications({
          recipientUserIds: [assigneeUserId],
          actorUserId: session.id,
          type: "operation_tasks_assigned",
          title: "Lucrari noi atribuite",
          message: `${result.updated} lucrari operationale au fost adaugate in Munca mea.`,
          entityId: result.batchId,
          metadata: { batchId: result.batchId, taskCount: result.updated }
        });
        if (result.previousAssigneeUserIds.length) {
          await createOperationalNotifications({
            recipientUserIds: result.previousAssigneeUserIds,
            actorUserId: session.id,
            type: "operation_tasks_reassigned",
            title: "Lucrari realocate",
            message: `${result.updated} lucrari operationale au fost realocate si nu mai apar in Munca mea.`,
            entityId: result.batchId,
            metadata: { batchId: result.batchId, taskCount: result.updated }
          });
        }
      } catch (error) {
        emitStructuredLog("error", "notification_sync_failed", {
          operation: "operation.assignment.notify",
          role: session.role,
          entityType: "operation_assignment_batch",
          entityId: result.batchId,
          errorCode: safeErrorCode(error, "OPERATION_ASSIGNMENT_NOTIFICATION_FAILED")
        });
      }
    }
    return NextResponse.json({ result }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignmentul nu a putut fi procesat.";
    const forbidden = /Doar COO|administratorul/i.test(message);
    return NextResponse.json({ error: message }, { status: forbidden ? 403 : 400, headers: noStoreHeaders });
  }
}

function textValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
