import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { listAdminLocations } from "@/lib/locations";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const { response } = await requirePermission(request, "inventory.manage");
  if (response) return response;

  const locations = await listAdminLocations();
  const headers = [
    "code",
    "category",
    "city",
    "county",
    "address",
    "type",
    "size",
    "sqm",
    "illum",
    "status",
    "availability",
    "availableFrom",
    "availableUntil",
    "bookedFrom",
    "bookedUntil",
    "publicStatus",
    "publicAvailability",
    "rateCard",
    "latReal",
    "lngReal",
    "latDisplay",
    "lngDisplay",
    "showInPublic",
    "showPricePublic",
    "gpsAuditStatus"
  ];

  const rows = locations.map((location) =>
    [
      location.code,
      location.categoryName,
      location.city,
      location.county,
      location.address,
      location.type,
      location.size,
      location.sqm,
      location.illum,
      location.status,
      location.availabilityText,
      location.availableFrom,
      location.availableUntil,
      location.bookedFrom,
      location.bookedUntil,
      location.publicStatus,
      location.availabilityDetail ? `${location.availabilityLabel} | ${location.availabilityDetail}` : location.availabilityLabel,
      location.rateCard,
      location.latReal,
      location.lngReal,
      location.latDisplay,
      location.lngDisplay,
      location.showInPublic,
      location.showPricePublic,
      location.gpsAuditStatus
    ].map(csvCell)
  );

  const csv = [headers.map(csvCell), ...rows].map((row) => row.join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="focus-locatii-${Date.now()}.csv"`
    }
  });
}
