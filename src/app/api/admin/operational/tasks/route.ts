import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import {
  listOperationalAssignmentTasks,
  operationalAssignmentEnabled,
  updateAssignedOperationalTaskStatus
} from "@/lib/operational-assignment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" };

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "campaigns.operate"]);
  if (response || !session) return response;
  if (!operationalAssignmentEnabled()) {
    return NextResponse.json({ error: "Pilotul de assignment operational nu este activ." }, { status: 404, headers: noStoreHeaders });
  }
  const includeCompleted = request.nextUrl.searchParams.get("includeCompleted") === "1";
  const tasks = await listOperationalAssignmentTasks({ session, includeCompleted });
  return NextResponse.json({ tasks }, { headers: noStoreHeaders });
}

export async function PATCH(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["dashboard.operations.view", "campaigns.operate"]);
  if (response || !session) return response;
  try {
    const body = await request.json().catch(() => null);
    const operationTaskId = textValue(body?.operationTaskId);
    const status = body?.status === "NEW" || body?.status === "IN_PROGRESS" ? body.status : null;
    if (!operationTaskId || !status) {
      return NextResponse.json({ error: "Taskul si statusul sunt obligatorii." }, { status: 400, headers: noStoreHeaders });
    }
    const task = await updateAssignedOperationalTaskStatus({ operationTaskId, status, session });
    return NextResponse.json({ task: { id: task.id, status: task.status } }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Statusul nu a putut fi actualizat.";
    const forbidden = /nu exista|nu este atribuita|Doar COO|pilotul/i.test(message);
    return NextResponse.json({ error: message }, { status: forbidden ? 403 : 400, headers: noStoreHeaders });
  }
}

function textValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
