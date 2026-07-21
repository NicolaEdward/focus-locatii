import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { observeRoute, setObservabilityRole } from "@/lib/observability";
import { listReceivableImports } from "@/lib/receivables-workspace-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, { route: "/api/admin/receivables-workspace/imports", operation: "receivables.imports" }, async () => {
    const { session, response } = await requireAnyPermission(request, ["finance.view", "finance.upload", "finance.validate"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const data = await listReceivableImports({
      page: Number(request.nextUrl.searchParams.get("page") || 1),
      take: Number(request.nextUrl.searchParams.get("take") || 25)
    });
    return NextResponse.json({ data });
  });
}
