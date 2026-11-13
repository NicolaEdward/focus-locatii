import { NextRequest, NextResponse } from "next/server";
import { listCachedPublicLocations } from "@/lib/locations";
import { observeRoute, setObservabilityRole } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Expires: "0",
  Pragma: "no-cache",
  "Surrogate-Control": "no-store"
};

const publicCacheHeaders = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120"
};

export async function GET(request: NextRequest) {
  return observeRoute(request, {
    route: "/api/locations",
    operation: "locations.list",
    budgetKey: "public_locations_api"
  }, async () => {
    const scope = request.nextUrl.searchParams.get("scope");

    if (scope === "admin") {
      const [{ requirePermission }, { listAdminLocations }] = await Promise.all([
        import("@/lib/auth"),
        import("@/lib/locations")
      ]);
      const { session, response } = await requirePermission(request, "inventory.view");
      if (response || !session) return response;
      setObservabilityRole(session.role);
      return NextResponse.json({ locations: await listAdminLocations() }, { headers: noStoreHeaders });
    }

    return NextResponse.json({ locations: await listCachedPublicLocations() }, { headers: publicCacheHeaders });
  });
}

export async function POST(request: NextRequest) {
  const [{ requireAnyPermission }, { createLocation, locationMutationFailure }, { serializeLocation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/locations")
  ]);
  const { session, response } = await requireAnyPermission(request, ["inventory.create", "inventory.manage"]);
  if (response || !session) return response;
  try {
    const full = await createLocation(await request.json(), session);
    return NextResponse.json(
      { location: serializeLocation(full, { includeHiddenCommercials: true, includePrivateFields: true, reservationViewer: session }) },
      { status: 201, headers: noStoreHeaders }
    );
  } catch (error) {
    const failure = locationMutationFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStoreHeaders });
  }
}
