import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { listReceivableReconciliation } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace/reconciliation", operation: "receivables.reconciliation" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const data = await listReceivableReconciliation({
      category: request.nextUrl.searchParams.get("category") || "all",
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      take: Number(request.nextUrl.searchParams.get("take") || 40)
    });
    return NextResponse.json({ data });
  });
}
