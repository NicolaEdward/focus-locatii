import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { restoreCoordinatesFromMapsUrls } from "@/lib/location-mutations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  return NextResponse.json(await restoreCoordinatesFromMapsUrls());
}
