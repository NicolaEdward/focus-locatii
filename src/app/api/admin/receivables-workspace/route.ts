import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listReceivableRegistry } from "@/lib/receivables-workspace-service";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace", operation: "receivables.workspace" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const registry = await listReceivableRegistry({
      query: request.nextUrl.searchParams.get("q") || "",
      status: request.nextUrl.searchParams.get("status") || "",
      companyCode: request.nextUrl.searchParams.get("companyCode") || "",
      currency: request.nextUrl.searchParams.get("currency") || "",
      view: request.nextUrl.searchParams.get("view") === "history" ? "history" : "open",
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      take: Number(request.nextUrl.searchParams.get("take") || 40)
    });
    return NextResponse.json({ registry }, {
      headers: { Deprecation: "true", Link: "</api/admin/receivables-workspace/registry>; rel=successor-version" }
    });
  });
}
