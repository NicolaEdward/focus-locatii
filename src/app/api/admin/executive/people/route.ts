import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getExecutivePeople } from "@/lib/dashboard/executive/refinement";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/executive/people",
    operation: "executive.people"
  }, async () => {
    const { session, response } = await requirePermission(request, "dashboard.executive.view");
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    return NextResponse.json(await getExecutivePeople(session, query), {
      headers: { "cache-control": "private, no-store" }
    });
  });
}
