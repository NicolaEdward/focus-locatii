import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listAdminReservationLocations } from "@/lib/locations";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/admin/reservation-locations",
    operation: "admin.reservation_locations.list"
  }, async () => {
    const { session, response } = await requirePermission(request, "inventory.view");
    if (response || !session) return response;
    setObservabilityRole(session.role);
    const locationIds = request.nextUrl.searchParams.getAll("locationId");

    return NextResponse.json(
      { locations: await listAdminReservationLocations(locationIds) },
      { headers: noStoreHeaders }
    );
  });
}
