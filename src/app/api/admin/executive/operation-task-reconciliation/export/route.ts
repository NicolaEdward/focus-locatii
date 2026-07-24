import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createOperationTaskHumanReviewWorkbook } from "@/lib/dashboard/executive/operation-task-review-export";
import { getOperationTaskCutoverReviewForExport } from "@/lib/dashboard/executive/operation-task-reconciliation";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(
    request,
    {
      route: "/api/admin/executive/operation-task-reconciliation/export",
      operation: "executive.operation_task_reconciliation_export"
    },
    async () => {
      const { session, response } = await requirePermission(request, "dashboard.executive.view");
      if (response || !session) return response;
      setObservabilityRole(session.role);
      try {
        const query = Object.fromEntries(request.nextUrl.searchParams.entries());
        const review = await getOperationTaskCutoverReviewForExport(session, query);
        const workbook = createOperationTaskHumanReviewWorkbook(review);
        return new NextResponse(workbook, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="operationtask-human-review-${new Date().toISOString().slice(0, 10)}.xlsx"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff"
          }
        });
      } catch {
        return NextResponse.json({ error: "Exportul dry-run nu este disponibil." }, { status: 500 });
      }
    }
  );
}
