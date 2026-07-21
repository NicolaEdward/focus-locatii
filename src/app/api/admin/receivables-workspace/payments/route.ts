import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { listReceivablePayments } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace/payments", operation: "receivables.payments" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const data = await listReceivablePayments({
      query: request.nextUrl.searchParams.get("q") || "",
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      take: Number(request.nextUrl.searchParams.get("take") || 40)
    });
    return NextResponse.json({ data });
  });
}
