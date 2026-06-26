import * as XLSX from "xlsx";
import { NextRequest, NextResponse } from "next/server";
import { formatAvailability } from "@/lib/availability";
import { mapsHref } from "@/lib/gps";
import { monthlyRate, oneTimeRate } from "@/lib/format";
import { listPublicLocations } from "@/lib/locations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ids = new Set(Array.isArray(body?.ids) ? body.ids.map(String) : []);
  if (ids.size > 200) {
    return NextResponse.json({ error: "Exportul este limitat la 200 de locatii." }, { status: 413 });
  }

  if (!ids.size) {
    return NextResponse.json({ error: "Nu exista locatii selectate pentru export." }, { status: 400 });
  }

  const selected = (await listPublicLocations()).filter((location) => ids.has(location.id));
  if (!selected.length) {
    return NextResponse.json({ error: "Locatiile selectate nu mai sunt disponibile public." }, { status: 404 });
  }

  const generatedAt = new Date();
  const workbook = XLSX.utils.book_new();
  const groups = groupByCategory(selected);

  for (const [categoryName, locations] of groups) {
    const rows = [
      [`Locații ${categoryName}`, "", "", "", "", "", "", "", "", "", "", "", ""],
      [
        "Nr",
        "City",
        "County",
        "Address",
        "Type",
        "GPS",
        "Photo Link",
        "Size",
        "SQM",
        "Illum",
        "Rate Card",
        "Installation & Removal",
        "Availability"
      ],
      ...locations.map((location, index) => [
        index + 1,
        location.city || "",
        location.county || "",
        location.address || location.code,
        location.type || "",
        mapsHref(location.mapsUrl, location.latDisplay, location.lngDisplay) === "#" ? "" : "Maps",
        location.mainPhotoUrl ? "Photo" : "",
        location.size || "",
        location.sqm ?? "",
        location.illum ? "Yes" : location.illum === false ? "No" : "",
        location.showPricePublic ? monthlyRate(location.rateCardValue, location.rateCard) : "",
        location.showInstallationCostPublic ? oneTimeRate(location.installationRemovalValue, location.installationRemoval) : "",
        formatAvailability({ label: location.availabilityLabel, detail: location.availabilityDetail })
      ])
    ];

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];
    sheet["!cols"] = defaultColumns();
    sheet["!autofilter"] = { ref: `A2:M${rows.length}` };
    sheet["!freeze"] = { xSplit: 0, ySplit: 2 };

    for (let rowIndex = 0; rowIndex < locations.length; rowIndex++) {
      const location = locations[rowIndex];
      const excelRow = rowIndex + 3;
      const mapsUrl = mapsHref(location.mapsUrl, location.latDisplay, location.lngDisplay);
      const photoUrl = absoluteUrl(request, location.mainPhotoUrl);

      if (mapsUrl !== "#") {
        const cell = sheet[`F${excelRow}`];
        if (cell) cell.l = { Target: mapsUrl, Tooltip: "Open in Google Maps" };
      }
      if (photoUrl) {
        const cell = sheet[`G${excelRow}`];
        if (cell) cell.l = { Target: photoUrl, Tooltip: "Open location photo" };
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(categoryName));
  }

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true
  });

  const filename = `focus-media-plan-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store"
    }
  });
}

function absoluteUrl(request: NextRequest, path?: string | null) {
  if (!path) return "";
  return new URL(path, request.nextUrl.origin).href;
}

function groupByCategory<T extends { categoryName: string }>(locations: T[]) {
  const groups = new Map<string, T[]>();
  for (const location of locations) {
    const group = groups.get(location.categoryName) || [];
    group.push(location);
    groups.set(location.categoryName, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ro"));
}

function defaultColumns() {
  return [
    { wch: 4 },
    { wch: 14 },
    { wch: 12 },
    { wch: 56 },
    { wch: 13 },
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 8 },
    { wch: 8 },
    { wch: 16 },
    { wch: 24 },
    { wch: 28 }
  ];
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Locatii";
}
