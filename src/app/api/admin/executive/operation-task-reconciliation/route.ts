import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getOperationTaskReconciliation } from "@/lib/dashboard/executive/operation-task-reconciliation";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(
    request,
    {
      route: "/api/admin/executive/operation-task-reconciliation",
      operation: "executive.operation_task_reconciliation"
    },
    async () => {
      const { session, response } = await requirePermission(request, "dashboard.executive.view");
      if (response || !session) return response;
      setObservabilityRole(session.role);
      try {
        const query = Object.fromEntries(request.nextUrl.searchParams.entries());
        return NextResponse.json(await getOperationTaskReconciliation(session, query), {
          headers: { "cache-control": "private, no-store" }
        });
      } catch {
        return NextResponse.json({ error: "Raportul OperationTask nu este disponibil." }, { status: 500 });
      }
    }
  );
}
