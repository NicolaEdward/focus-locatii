import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { listReceivableRegistry } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace/registry", operation: "receivables.registry" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.validate", "finance.manage"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const params = request.nextUrl.searchParams;
    const registry = await listReceivableRegistry({
      query: params.get("q") || "",
      status: params.get("status") || "",
      companyCode: params.get("companyCode") || "",
      currency: params.get("currency") || "",
      ownerUserId: params.get("owner") || "",
      asOf: params.get("snapshot") || "",
      validatedOnly: params.get("validated") === "1",
      view: params.get("view") === "history" ? "history" : "open",
      page: Number(params.get("page") || 1),
      take: Number(params.get("take") || 40)
    });
    return NextResponse.json({ registry });
  });
}
