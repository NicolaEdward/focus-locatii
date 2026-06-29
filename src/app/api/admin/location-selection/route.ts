import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listLocationSelectionLocations } from "@/lib/location-selection";
import type { LocationSelectionFilters } from "@/lib/location-selection-dto";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
};

export async function GET(request: NextRequest) {
  const { session, response } = await requirePermission(request, "inventory.view");
  if (response || !session) return response;

  const params = request.nextUrl.searchParams;
  const filters: LocationSelectionFilters = {
    search: params.get("search"),
    city: params.get("city"),
    area: params.get("area"),
    mediaType: params.get("mediaType"),
    status: params.get("status"),
    minSurface: numberParam(params.get("minSurface")),
    maxSurface: numberParam(params.get("maxSurface")),
    minPrice: numberParam(params.get("minPrice")),
    maxPrice: numberParam(params.get("maxPrice")),
    hasImage: booleanParam(params.get("hasImage")),
    hasPublicPrice: booleanParam(params.get("hasPublicPrice")),
    sort: sortParam(params.get("sort"))
  };

  const payload = await listLocationSelectionLocations(filters, session);
  return NextResponse.json(payload, { headers: noStoreHeaders });
}

function numberParam(value: string | null) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanParam(value: string | null) {
  if (value == null || value === "") return null;
  return value === "1" || value === "true";
}

function sortParam(value: string | null): LocationSelectionFilters["sort"] {
  const allowed = new Set(["selected", "availability", "code", "city", "surface_desc", "price_asc", "price_desc", "updated_desc"]);
  return allowed.has(String(value)) ? (value as LocationSelectionFilters["sort"]) : "code";
}
