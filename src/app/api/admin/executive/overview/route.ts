import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getExecutiveOverview } from "@/lib/dashboard/executive/overview";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(
    request,
    {
      route: "/api/admin/executive/overview",
      operation: "executive.overview",
      budgetKey: "executive_overview_api"
    },
    async () => {
      const { session, response } = await requirePermission(request, "dashboard.executive.view");
      if (response || !session) return response;
      setObservabilityRole(session.role);
      try {
        const query = Object.fromEntries(request.nextUrl.searchParams.entries());
        return NextResponse.json(await getExecutiveOverview(session, query), {
          headers: { "cache-control": "private, no-store" }
        });
      } catch {
        return NextResponse.json(
          { error: "Executive Overview indisponibil." },
          { status: 500 }
        );
      }
    }
  );
}
