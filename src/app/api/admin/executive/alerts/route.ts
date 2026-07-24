import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getExecutiveAlerts } from "@/lib/dashboard/executive/alerts";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(
    request,
    {
      route: "/api/admin/executive/alerts",
      operation: "executive.alerts",
      budgetKey: "executive_alerts_api"
    },
    async () => {
      const { session, response } = await requirePermission(request, "dashboard.executive.view");
      if (response || !session) return response;
      setObservabilityRole(session.role);
      try {
        const query = Object.fromEntries(request.nextUrl.searchParams.entries());
        return NextResponse.json(await getExecutiveAlerts(session, query), {
          headers: { "cache-control": "private, no-store" }
        });
      } catch {
        return NextResponse.json({ error: "Executive Alerts indisponibil." }, { status: 500 });
      }
    }
  );
}

