import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLocation } from "@/lib/location-mutations";
import { listAdminLocations, listCachedPublicLocations, serializeLocation } from "@/lib/locations";
import { requirePermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

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
  const scope = request.nextUrl.searchParams.get("scope");

  if (scope === "admin") {
    const { response } = await requirePermission(request, "inventory.view");
    if (response) return response;
    return NextResponse.json({ locations: await listAdminLocations() }, { headers: noStoreHeaders });
  }

  return NextResponse.json({ locations: await listCachedPublicLocations() }, { headers: publicCacheHeaders });
}

export async function POST(request: NextRequest) {
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
