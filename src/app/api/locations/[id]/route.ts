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
    const { response } = await requirePermission(request, "inventory.view");
    if (response) return response;
    const location = await getAdminLocation(id);
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
  const [{ requirePermission }, { updateLocation }, { prisma }, { recordAudit }, { serializeLocation }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/prisma"),
    import("@/lib/audit"),
    import("@/lib/locations")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;

  const { id } = await context.params;
  const body = await request.json();
  const updated = await updateLocation(id, body);
  const full = await prisma.location.findUniqueOrThrow({
    where: { id: updated.id },
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
  await recordAudit({ actor: session, action: "location.update", entityType: "location", entityId: id, metadata: { code: full.code }, request });

  return NextResponse.json(
    { location: serializeLocation(full, { includeHiddenCommercials: true, includePrivateFields: true }) },
    { headers: noStoreHeaders }
  );
}

export async function POST(request: NextRequest, context: Context) {
  const [{ requirePermission }, { duplicateLocation }, { recordAudit }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/location-mutations"),
    import("@/lib/audit")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;

  const { id } = await context.params;
  const action = request.nextUrl.searchParams.get("action");
  if (action !== "duplicate") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: noStoreHeaders });
  }

  const duplicate = await duplicateLocation(id);
  await recordAudit({ actor: session, action: "location.duplicate", entityType: "location", entityId: duplicate.id, request });
  return NextResponse.json({ location: duplicate }, { status: 201, headers: noStoreHeaders });
}

export async function DELETE(request: NextRequest, context: Context) {
  const [{ requirePermission }, { prisma }, { recordAudit }] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/prisma"),
    import("@/lib/audit")
  ]);
  const { session, response } = await requirePermission(request, "inventory.manage");
  if (response || !session) return response;

  const { id } = await context.params;
  const reservationCount = await prisma.reservation.count({ where: { locationId: id } });
  if (reservationCount > 0) {
    return NextResponse.json({ error: "Locatia are istoric comercial si nu poate fi stearsa. Ascunde-o din portalul public." }, { status: 409 });
  }
  await prisma.location.delete({ where: { id } });
  await recordAudit({ actor: session, action: "location.delete", entityType: "location", entityId: id, request });
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
}
