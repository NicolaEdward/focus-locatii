import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createLocation, updateLocation } from "@/lib/location-mutations";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  const body = await request.json();
  const locations = Array.isArray(body?.locations) ? body.locations : [];
  if (locations.length > 1000) {
    return NextResponse.json({ error: "Importul JSON este limitat la 1000 de locatii per operatiune." }, { status: 413 });
  }
  let created = 0;
  let updated = 0;

  for (const location of locations) {
    const existing = location.code
      ? await prisma.location.findUnique({
          where: { code: String(location.code) }
        })
      : null;

    if (existing) {
      await updateLocation(existing.id, location);
      updated += 1;
    } else {
      await createLocation(location);
      created += 1;
    }
  }

  return NextResponse.json({ created, updated, total: locations.length });
}
