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
  const [{ requirePermission }, { createLocation }, { prisma }, { recordAudit }, { serializeLocation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/prisma"),
    import("@/lib/audit"),
    import("@/lib/locations")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;

  const body = await request.json();
  const location = await createLocation(body);
  const full = await prisma.location.findUniqueOrThrow({
    where: { id: location.id },
    include: {
      category: true,
      images: {
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }]
      },
      reservations: {
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
      }
    }
  });
  await recordAudit({ actor: session, action: "location.create", entityType: "location", entityId: full.id, metadata: { code: full.code }, request });

  return NextResponse.json(
    { location: serializeLocation(full, { includeHiddenCommercials: true, includePrivateFields: true }) },
    { status: 201, headers: noStoreHeaders }
  );
}
