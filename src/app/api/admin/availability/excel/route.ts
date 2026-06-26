import { NextRequest, NextResponse } from "next/server";
import { calculateAvailability, formatAvailability, type CalculatedAvailability } from "@/lib/availability";
import { mapsHref } from "@/lib/gps";
import { listAdminLocations } from "@/lib/locations";
import { sortOperationalLocations } from "@/lib/location-order";
import { requireAnyPermission } from "@/lib/auth";
import { createStyledWorkbook, XLSX_STYLES, type StyledCell, type StyledSheet } from "@/lib/styled-xlsx";
import type { LocationDTO } from "@/types/location";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = [
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
];

export async function GET(request: NextRequest) {
  const { response } = await requireAnyPermission(request, ["reports.view", "reports.view.own"]);
  if (response) return response;

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const from = parseDateParam(fromParam);
  const to = parseDateParam(toParam);
  if ((fromParam && !from) || (toParam && !to)) {
    return NextResponse.json({ error: "Perioada selectata nu este valida." }, { status: 400 });
  }
  const city = request.nextUrl.searchParams.get("city")?.trim().toLowerCase();
  const county = request.nextUrl.searchParams.get("county")?.trim().toLowerCase();
  const type = request.nextUrl.searchParams.get("type")?.trim().toLowerCase();
  const status = request.nextUrl.searchParams.get("status")?.trim().toUpperCase();
  const category = request.nextUrl.searchParams.get("category")?.trim().toLowerCase();
  const search = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const ids = new Set(
    (request.nextUrl.searchParams.get("ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const includeHidden = request.nextUrl.searchParams.get("includeHidden") === "1";

  const periodStart = from || to;
  const periodEnd = to || from;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return NextResponse.json({ error: "Perioada selectata nu este valida." }, { status: 400 });
  }

  const locations = (await listAdminLocations())
    .filter((location) => includeHidden || location.showInPublic)
    .filter((location) => (ids.size ? ids.has(location.id) : true))
    .filter((location) => {
      if (!search) return true;
      return [location.code, location.city, location.county, location.address, location.type, location.categoryName]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .filter((location) => (city ? location.city?.toLowerCase() === city : true))
    .filter((location) => (county ? location.county?.toLowerCase() === county : true))
    .filter((location) => (type ? location.type?.toLowerCase() === type : true))
    .filter((location) => (category ? location.categorySlug === category : true))
    .filter((location) => (status ? location.publicStatus === status || location.status === status : true))
    .filter((location) => {
      if (periodStart && periodEnd) {
        return calculateAvailability(location, periodStart, periodEnd).status !== "UNAVAILABLE";
      }
      return location.publicStatus !== "UNKNOWN";
    });

  const groups = groupByCategory(locations);
  const sheets: StyledSheet[] = [];

  for (const [categoryName, groupLocations] of groups) {
    const orderedLocations = [...groupLocations].sort(sortOperationalLocations);
    sheets.push({
      name: categoryName,
      rows: [
        titleRow(`Locatii ${categoryName}`),
        headers.map((header) => ({ value: header, style: XLSX_STYLES.header })),
        ...orderedLocations.map((location, index) => locationRow(request, location, index, periodStart, periodEnd))
      ],
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 13 }],
      columns: defaultColumns().map((width) => ({ width })),
      freezeRows: 2,
      autoFilter: { startRow: 2, startCol: 1, endRow: Math.max(groupLocations.length + 2, 2), endCol: 13 }
    });
  }

  if (!sheets.length) {
    sheets.push({
      name: "Disponibil",
      rows: [
        titleRow("Nu exista locatii disponibile pentru filtrele selectate."),
        headers.map((header) => ({ value: header, style: XLSX_STYLES.header }))
      ],
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 13 }],
      columns: defaultColumns().map((width) => ({ width })),
      freezeRows: 2
    });
  }

  const buffer = createStyledWorkbook(sheets);

  const periodLabel = periodStart && periodEnd ? `-${formatFileDate(periodStart)}-${formatFileDate(periodEnd)}` : "";
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="focus-disponibil${periodLabel}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

function titleRow(title: string): StyledCell[] {
  return Array.from({ length: 13 }, (_, index) => ({
    value: index === 0 ? title : "",
    style: XLSX_STYLES.title
  }));
}

function locationRow(
  request: NextRequest,
  location: LocationDTO,
  index: number,
  periodStart: Date | null,
  periodEnd: Date | null
): StyledCell[] {
  const bodyStyle = index % 2 === 0 ? XLSX_STYLES.body : XLSX_STYLES.bodyAlt;
  const mapUrl = mapsHref(location.mapsUrl, location.latReal, location.lngReal);
  const photoUrl = absoluteUrl(request, location.mainPhotoUrl);
  const calculated = periodStart && periodEnd ? calculateAvailability(location, periodStart, periodEnd) : null;
  const availability = calculated
    ? formatAvailability({ label: calculated.label, detail: calculated.detail })
    : formatAvailability({ label: location.availabilityLabel, detail: location.availabilityDetail });

  return [
    { value: index + 1, style: XLSX_STYLES.centered },
    { value: location.city || "", style: bodyStyle },
    { value: location.county || "", style: bodyStyle },
    { value: location.address || location.code, style: bodyStyle },
    { value: location.type || "", style: bodyStyle },
    { value: mapUrl === "#" ? "" : "Maps", style: mapUrl === "#" ? bodyStyle : XLSX_STYLES.hyperlink, hyperlink: mapUrl === "#" ? undefined : mapUrl },
    { value: photoUrl ? "Photo" : "", style: photoUrl ? XLSX_STYLES.hyperlink : bodyStyle, hyperlink: photoUrl || undefined },
    { value: location.size || "", style: bodyStyle },
    { value: location.sqm ?? "", style: XLSX_STYLES.centered },
    { value: location.illum ? "Yes" : location.illum === false ? "No" : "", style: XLSX_STYLES.centered },
    { value: euroCell(location.rateCardValue, location.rateCard), style: bodyStyle },
    { value: euroCell(location.installationRemovalValue, location.installationRemoval), style: bodyStyle },
    { value: availability, style: availabilityStyle(location, calculated) }
  ];
}

function availabilityStyle(location: LocationDTO, calculated?: CalculatedAvailability | null) {
  if (calculated) {
    if (calculated.status === "AVAILABLE") return XLSX_STYLES.availabilityAvailable;
    if (calculated.status === "PARTIAL") return XLSX_STYLES.availabilityReserved;
    if (calculated.status === "UNAVAILABLE") return XLSX_STYLES.availabilityBooked;
  }
  if (location.publicStatus === "AVAILABLE") {
    return location.availabilityDetail ? XLSX_STYLES.availabilityReserved : XLSX_STYLES.availabilityAvailable;
  }
  if (location.publicStatus === "RESERVED") return XLSX_STYLES.availabilityReserved;
  if (location.publicStatus === "BOOKED") return XLSX_STYLES.availabilityBooked;
  return XLSX_STYLES.body;
}

function parseDateParam(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function groupByCategory(locations: LocationDTO[]) {
  const groups = new Map<string, LocationDTO[]>();
  for (const location of locations) {
    const group = groups.get(location.categoryName) || [];
    group.push(location);
    groups.set(location.categoryName, group);
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ro"));
}

function euroCell(value?: number | null, fallback?: string | null) {
  const parsed = value ?? parseNumber(fallback);
  if (parsed == null) return fallback?.trim() || "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(parsed);
}

function parseNumber(value?: string | null) {
  const match = String(value || "")
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteUrl(request: NextRequest, path?: string | null) {
  if (!path) return "";
  return new URL(path, request.nextUrl.origin).href;
}

function defaultColumns() {
  return [
    4,
    14,
    12,
    56,
    14,
    7,
    12,
    14,
    8,
    8,
    16,
    24,
    32
  ];
}

function formatFileDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
