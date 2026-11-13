import { NextRequest, NextResponse } from "next/server";
import { getPublicLocation } from "@/lib/locations";

type Context = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Expires: "0",
  Pragma: "no-cache",
  "Surrogate-Control": "no-store"
};

const publicCacheHeaders = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120"
};

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const admin = request.nextUrl.searchParams.get("scope") === "admin";

  if (admin) {
    const [{ requirePermission }, { getAdminLocation }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/locations")
    ]);
    const { session, response } = await requirePermission(request, "inventory.view");
    if (response || !session) return response;
    const location = await getAdminLocation(id, session);
    return location
      ? NextResponse.json({ location }, { headers: noStoreHeaders })
      : NextResponse.json({ error: "Location not found" }, { status: 404, headers: noStoreHeaders });
  }

  const location = await getPublicLocation(id);
  return location
    ? NextResponse.json({ location }, { headers: publicCacheHeaders })
    : NextResponse.json({ error: "Location not found" }, { status: 404, headers: publicCacheHeaders });
}

export async function PATCH(request: NextRequest, context: Context) {
  const [{ requirePermission }, { updateLocation, locationMutationFailure }, { serializeLocation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/locations")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    const full = await updateLocation(id, await request.json(), session);
    return NextResponse.json(
      { location: serializeLocation(full, { includeHiddenCommercials: true, includePrivateFields: true, reservationViewer: session }) },
      { headers: noStoreHeaders }
    );
  } catch (error) {
    const failure = locationMutationFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest, context: Context) {
  const [{ requirePermission }, { duplicateLocation, locationMutationFailure }, { serializeLocation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/locations")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;
  if (request.nextUrl.searchParams.get("action") !== "duplicate") {
    return NextResponse.json({ error: "Acțiune nesuportată." }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const { id } = await context.params;
    const duplicate = await duplicateLocation(id, session);
    return NextResponse.json(
      { location: serializeLocation(duplicate, { includeHiddenCommercials: true, includePrivateFields: true, reservationViewer: session }) },
      { status: 201, headers: noStoreHeaders }
    );
  } catch (error) {
    const failure = locationMutationFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStoreHeaders });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const [{ requirePermission }, { deleteLocation, locationMutationFailure }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;
  try {
    const { id } = await context.params;
    await deleteLocation(id, session);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    const failure = locationMutationFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status, headers: noStoreHeaders });
  }
}
