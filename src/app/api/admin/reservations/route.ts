import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/auth";
import { listReservationPage } from "@/lib/reservations";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/reservations",
    operation: "admin.reservations.page"
  }, async () => {
    const { session, response } = await requireAnyPermission(request, ["reservations.view", "reservations.view.own"]);
    if (response || !session) return response;
    setObservabilityRole(session.role);

    const params = request.nextUrl.searchParams;
    const result = await listReservationPage({
      query: params.get("q"),
      status: params.get("status"),
      scope: params.get("scope"),
      page: params.get("page"),
      pageSize: params.get("pageSize")
    }, session);
    return NextResponse.json(result, { headers: noStoreHeaders });
  });
}
