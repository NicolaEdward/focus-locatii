import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listReceivablesWorkspace } from "@/lib/receivables-import-service";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace", operation: "receivables.workspace" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const workspace = await listReceivablesWorkspace({
      query: request.nextUrl.searchParams.get("q") || "",
      status: request.nextUrl.searchParams.get("status") || "",
      companyCode: request.nextUrl.searchParams.get("companyCode") || "",
      currency: request.nextUrl.searchParams.get("currency") || "",
      take: Number(request.nextUrl.searchParams.get("take") || 100)
    });
    return NextResponse.json({ workspace });
  });
}
