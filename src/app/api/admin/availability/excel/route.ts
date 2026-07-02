import { NextRequest, NextResponse } from "next/server";
import { mapsHref } from "@/lib/gps";
import { getLocationSelectionAvailability } from "@/lib/location-selection-availability";
import { isManualAvailabilityStatus, manualAvailabilityStatusLabel } from "@/lib/location-availability-overrides";
import { listAdminLocations } from "@/lib/locations";
import { sortOperationalLocations } from "@/lib/location-order";
import { requireAnyPermission } from "@/lib/auth";
import { createStyledWorkbook, XLSX_STYLES, type StyledCell, type StyledSheet } from "@/lib/styled-xlsx";
import type { LocationSelectionAvailability } from "@/lib/location-selection-dto";
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
  "Schita",
  "Availability"
];

export async function GET(request: NextRequest) {
  const { session, response } = await requireAnyPermission(request, ["reports.view", "reports.view.own"]);
  if (response || !session) return response;

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
  const includeUnavailable = request.nextUrl.searchParams.get("includeUnavailable") === "1";

  const periodStart = from || to;
  const periodEnd = to || from;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return NextResponse.json({ error: "Perioada selectata nu este valida." }, { status: 400 });
  }

  const baseLocations = (await listAdminLocations())
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
    .filter((location) => (status ? location.publicStatus === status || location.status === status : true));
  const availabilityById = await getLocationSelectionAvailability({
    locationIds: baseLocations.map((location) => location.id),
    periodStart: fromParam,
    periodEnd: toParam,
    session
  });
  const locations = baseLocations.filter((location) => {
    const availability = availabilityById[location.id];
    if (from && to && !includeUnavailable) return availability?.state !== "CONFLICT";
    return availability?.state !== "UNKNOWN";
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
        ...orderedLocations.map((location, index) => locationRow(request, location, index, availabilityById[location.id]))
      ],
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 14 }],
      columns: defaultColumns().map((width) => ({ width })),
      freezeRows: 2,
      autoFilter: { startRow: 2, startCol: 1, endRow: Math.max(groupLocations.length + 2, 2), endCol: 14 }
    });
  }

  if (!sheets.length) {
    sheets.push({
      name: "Disponibil",
      rows: [
        titleRow("Nu exista locatii disponibile pentru filtrele selectate."),
        headers.map((header) => ({ value: header, style: XLSX_STYLES.header }))
      ],
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 14 }],
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
  return Array.from({ length: 14 }, (_, index) => ({
    value: index === 0 ? title : "",
    style: XLSX_STYLES.title
  }));
}

function locationRow(
  request: NextRequest,
  location: LocationDTO,
  index: number,
  availability: LocationSelectionAvailability | undefined
): StyledCell[] {
  const bodyStyle = index % 2 === 0 ? XLSX_STYLES.body : XLSX_STYLES.bodyAlt;
  const mapUrl = mapsHref(null, location.latDisplay, location.lngDisplay);
  const photoUrl = absoluteUrl(request, location.mainPhotoUrl);
  const sketchUrl = absoluteUrl(request, location.productionSketchUrl);
  const availabilityLabel = availabilityLabelForExport(availability);

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
    { value: sketchUrl ? "Schita" : "", style: sketchUrl ? XLSX_STYLES.hyperlink : bodyStyle, hyperlink: sketchUrl || undefined },
    { value: availabilityLabel, style: availabilityStyle(availability) }
  ];
}

function availabilityStyle(availability?: LocationSelectionAvailability) {
  if (availability?.state === "AVAILABLE") return availability.tone === "yellow" ? XLSX_STYLES.availabilityReserved : XLSX_STYLES.availabilityAvailable;
  if (availability?.state === "PARTIAL") return XLSX_STYLES.availabilityReserved;
  if (availability?.state === "CONFLICT") return XLSX_STYLES.availabilityBooked;
  return XLSX_STYLES.body;
}

function availabilityLabelForExport(availability?: LocationSelectionAvailability) {
  if (!availability) return "Disponibilitate necunoscuta";
  const parts = [availability.label, availability.explanation, occupiedIntervalsLabel(availability)]
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" | ");
}

function occupiedIntervalsLabel(availability: LocationSelectionAvailability) {
  if (!availability.blockingIntervals.length) return "";
  return availability.blockingIntervals
    .slice(0, 3)
    .map((interval) => {
      const action = isManualAvailabilityStatus(interval.status) ? manualAvailabilityStatusLabel(interval.status) : "Ocupat";
      const end = interval.openEnded ? "" : ` - ${formatDate(new Date(interval.end))}`;
      return `${action}: ${formatDate(new Date(interval.start))}${end}`;
    })
    .join("; ");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
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
    14,
    32
  ];
}

function formatFileDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
