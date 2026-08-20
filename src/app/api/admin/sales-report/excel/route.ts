import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { normalizeMediaType } from "@/lib/format";
import { sortOperationalLocations } from "@/lib/location-order";
import { prisma } from "@/lib/prisma";
import { calculateProrata } from "@/lib/prorata";
import { isSalesReportInventoryEligible } from "@/lib/sales-report-inventory";
import { createStyledWorkbook, XLSX_STYLES, type StyledCell, type StyledSheet } from "@/lib/styled-xlsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const modelHeaders = [
  "Nr",
  "City",
  "County",
  "Adress",
  "Type",
  "Size",
  "SQM",
  "Illum",
  "Ratecard/\r\nmonth",
  "PRET DE VANZARE ",
  "Client"
];

// Mirrors the commercial order used by the sales workbook supplied by Focus Media.
const salesReportReferenceOrder = [
  "B011FLTA",
  "B011FLTB",
  "B012FLTA",
  "B012FLTB",
  "PH031FLTA",
  "IF0692B",
  "IF0692A",
  "B014FLTA",
  "IF088FLTA",
  "IF088FLTB",
  "PH029FLTA",
  "PH029FLTB",
  "IF023FLTB",
  "IF025FLTA",
  "PH031FLTB",
  "IF025FLTB",
  "B014FLTB",
  "IF020FLTA",
  "IF020FLTB",
  "IF023FLTA",
  "PH033FLTA",
  "PH033FLTB",
  "PH035FLTA",
  "PH035FLTB",
  "PH037FLTA",
  "PH037FLTB",
  "PH038FLTA",
  "PH038FLTB",
  "PH044FLTA",
  "PH044FLTB",
  "PH046FLTA",
  "PH046FLTB",
  "IF026FLTA",
  "IF026FLTB",
  "IF027FLTA",
  "IF027FLTB",
  "IF028FLTA",
  "IF028FLTB",
  "IF029FLTA",
  "IF029FLTB",
  "IF030FLTA",
  "IF030FLTB",
  "IF031FLTA",
  "IF031FLTB",
  "IF032FLTA",
  "IF032FLTB",
  "IF033FLTA",
  "IF033FLTB",
  "IF034FLTA",
  "IF034FLTB",
  "IF035FLTA",
  "IF035FLTB",
  "GR01FLTA",
  "GR01FLTB",
  "GR02FLTA",
  "GR02FLTB",
  "B01MSH",
  "PRSMG1",
  "PRSMG2",
  "PRSMG3",
  "PRSMG4",
  "IF002BKA",
  "IF002BKB",
  "IF003BKA",
  "IF003BKB",
  "B01BK",
  "B02BK",
  "IF036FLTA",
  "IF036FLTB",
  "IF037FLTA",
  "IF037FLTB",
  "IF038FLTA",
  "OUT4",
  "OUT14",
  "EPZPE-1-2",
  "PF1V9C",
  "SBB6C",
  "PRSMGR1",
  "PRSMGR2",
  "TIM01MSH",
  "MESH03",
  "MESH04",
  "EPZP7A",
  "EPZP8A",
  "PZPP1W",
  "PZPP2W",
  "PZPP3W",
  "OUTFPS3",
  "SP1C",
  "SP5A",
  "SP6A",
  "SP7A",
  "SP8A",
  "SP19A",
  "SBB1L",
  "SZPP7",
  "SZPP8",
  "SZP1W"
] as const;

const salesReportReferenceRank = new Map<string, number>(
  salesReportReferenceOrder.map((code, index) => [code, index])
);

const salesReportLocationSelect = {
  nr: true,
  code: true,
  status: true,
  lifecycleStatus: true,
  city: true,
  county: true,
  address: true,
  type: true,
  size: true,
  sqm: true,
  illum: true,
  rateCard: true,
  rateCardValue: true,
  availabilityText: true,
  availableFrom: true,
  availableUntil: true,
  bookedFrom: true,
  bookedUntil: true,
  blockedReason: true,
  blockedFrom: true,
  blockedUntil: true,
  reportingGroupName: true,
  displayOrder: true,
  locationGroupOrder: true,
  faceOrder: true,
  directionOrder: true,
  category: { select: { name: true } }
} satisfies Prisma.LocationSelect;

const salesReportAvailabilityOverrideSelect = {
  id: true,
  type: true,
  reason: true,
  periodStart: true,
  periodEnd: true,
  clearedAt: true
} satisfies Prisma.LocationAvailabilityOverrideSelect;

const salesReportReservationSelect = {
  status: true,
  clientName: true,
  campaignName: true,
  amount: true,
  monthlyRentTotal: true,
  monthlyRentShare: true,
  contractGroupId: true,
  periodStart: true,
  periodEnd: true
} satisfies Prisma.ReservationSelect;

type SalesReportLocation = Prisma.LocationGetPayload<{ select: typeof salesReportLocationSelect }> & {
  reservations: SalesReportReservation[];
  availabilityOverrides: SalesReportAvailabilityOverride[];
};
type SalesReportReservation = Prisma.ReservationGetPayload<{ select: typeof salesReportReservationSelect }>;
type SalesReportAvailabilityOverride = Prisma.LocationAvailabilityOverrideGetPayload<{
  select: typeof salesReportAvailabilityOverrideSelect;
}>;

export async function GET(request: NextRequest) {
  const { response } = await requirePermission(request, "reports.view");
  if (response) return response;

  const monthParam = request.nextUrl.searchParams.get("month");
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const monthRange = parseMonthParam(monthParam);
  const from = parseDateParam(fromParam);
  const to = parseDateParam(toParam);

  if ((monthParam && !monthRange) || (fromParam && !from) || (toParam && !to)) {
    return NextResponse.json({ error: "Perioada selectata nu este valida." }, { status: 400 });
  }

  const defaultMonth = currentMonthRange();
  const periodStart = monthRange?.from || from || to || defaultMonth.from;
  const periodEnd = monthRange?.to || to || from || defaultMonth.to;

  if (periodStart > periodEnd) {
    return NextResponse.json({ error: "Perioada selectata nu este valida." }, { status: 400 });
  }

  const locations = (await listSalesReportLocations(periodStart, periodEnd)).sort(sortSalesLocations);
  const rows = locations
    .map((location, index) => salesRow(location, index, periodStart, periodEnd))
    .sort(sortSalesRows)
    .map((row, index) => ({
      ...row,
      cells: row.cells.map((cell, cellIndex) => (cellIndex === 0 ? { ...cell, value: index + 1 } : cell))
    }));
  const soldRows = rows.filter((row) => row.sold);
  const unsoldRows = rows.filter((row) => !row.sold);
  const totalSales = roundMoney(soldRows.reduce((sum, row) => sum + row.amount, 0));
  const totalUnsoldPotential = roundMoney(unsoldRows.reduce((sum, row) => sum + row.potentialAmount, 0));
  const totalCommercialValue = roundMoney(totalSales + totalUnsoldPotential);
  const soldPercent = locations.length ? soldRows.length / locations.length : 0;
  const unsoldPercent = 1 - soldPercent;
  const soldValuePercent = totalCommercialValue ? totalSales / totalCommercialValue : 0;
  const unsoldValuePercent = totalCommercialValue ? totalUnsoldPotential / totalCommercialValue : 0;
  const soldSummaryRow = rows.length + 5;
  const unsoldSummaryRow = rows.length + 7;

  const sheet: StyledSheet = {
    name: "Situatie vanzari",
    rows: [
      titleRow(`LOCATII FOCUS MEDIA ${formatDate(periodEnd)}`, periodHeaderLabel(periodStart, periodEnd)),
      emptyModelRow(),
      modelHeaderRow(),
      ...rows.map((row) => row.cells),
      emptyModelRow(),
      totalsRow(
        "NUMAR LOCATII VANDUTE -",
        `${soldRows.length} (${percentLabel(soldPercent)})`,
        "SUMA LOCATII VANDUTE",
        totalSales,
        soldValuePercent,
        XLSX_STYLES.availabilityAvailable
      ),
      emptyModelRow(),
      totalsRow(
        "NUMAR LOCATII NEVANDUTE",
        `${unsoldRows.length} (${percentLabel(unsoldPercent)})`,
        "SUMA LOCATII NEVANDUTE",
        totalUnsoldPotential,
        unsoldValuePercent,
        XLSX_STYLES.availabilityReserved
      )
    ],
    merges: [
      { startRow: 1, startCol: 2, endRow: 1, endCol: 10 },
      ...summaryRowMerges(soldSummaryRow),
      ...summaryRowMerges(unsoldSummaryRow)
    ],
    columns: [6, 15, 18, 42, 16, 18, 10, 10, 17, 19, 44].map((width) => ({ width })),
    freezeRows: 3,
    autoFilter: { startRow: 3, startCol: 1, endRow: Math.max(rows.length + 3, 3), endCol: modelHeaders.length }
  };

  const summarySheet: StyledSheet = {
    name: "Totaluri",
    rows: [
      [{ value: "SUMAR SITUATIE VANZARI", style: XLSX_STYLES.title }, ...blankCells(4)],
      emptySummaryRow(),
      [
        { value: "Perioada", style: XLSX_STYLES.header },
        { value: `${formatDate(periodStart)} - ${formatDate(periodEnd)}`, style: XLSX_STYLES.body },
        { value: "Total vanzari pro-rata", style: XLSX_STYLES.header },
        { value: `${moneyLabel(totalSales)} EUR + TVA`, style: XLSX_STYLES.body },
        { value: "", style: XLSX_STYLES.body }
      ],
      [
        { value: "Locatii vandute", style: XLSX_STYLES.header },
        { value: soldRows.length, style: XLSX_STYLES.centered },
        { value: "Locatii nevandute", style: XLSX_STYLES.header },
        { value: locations.length - soldRows.length, style: XLSX_STYLES.centered },
        { value: "", style: XLSX_STYLES.body }
      ],
      [
        { value: "Procent vandute", style: XLSX_STYLES.header },
        { value: percentLabel(soldPercent), style: XLSX_STYLES.body },
        { value: "Potential nevandut", style: XLSX_STYLES.header },
        { value: `${moneyLabel(totalUnsoldPotential)} EUR + TVA`, style: XLSX_STYLES.body },
        { value: percentLabel(unsoldPercent), style: XLSX_STYLES.body }
      ],
      [
        { value: "Metoda pro-rata", style: XLSX_STYLES.header },
        { value: "Chirie lunara x zile active / zile calendaristice ale lunii", style: XLSX_STYLES.body },
        { value: "Valoare comerciala perioada", style: XLSX_STYLES.header },
        { value: `${moneyLabel(totalCommercialValue)} EUR + TVA`, style: XLSX_STYLES.body },
        { value: "", style: XLSX_STYLES.body }
      ]
    ],
    merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 5 }],
    columns: [24, 28, 24, 28, 18].map((width) => ({ width }))
  };

  const buffer = createStyledWorkbook([sheet, summarySheet]);

  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="focus-situatie-vanzari-${formatFileDate(periodStart)}-${formatFileDate(periodEnd)}.xlsx"`,
      "cache-control": "no-store"
    }
  });
}

async function listSalesReportLocations(periodStart: Date, periodEnd: Date): Promise<SalesReportLocation[]> {
  const locations = await prisma.location.findMany({
    where: {
      lifecycleStatus: "ACTIVE"
    },
    select: {
      ...salesReportLocationSelect,
      reservations: {
        where: {
          status: "BOOKED",
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart }
        },
        select: salesReportReservationSelect,
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
      },
      availabilityOverrides: {
        where: {
          clearedAt: null,
          periodStart: { lte: periodEnd },
          OR: [{ periodEnd: null }, { periodEnd: { gte: periodStart } }]
        },
        select: salesReportAvailabilityOverrideSelect,
        orderBy: [{ periodStart: "asc" }, { periodEnd: "asc" }]
      }
    }
  });

  return locations
    .filter((location) => isSalesReportInventoryEligible({
      status: location.status,
      lifecycleStatus: location.lifecycleStatus,
      availabilityText: location.availabilityText,
      availableFrom: location.availableFrom,
      availableUntil: location.availableUntil,
      bookedFrom: location.bookedFrom,
      bookedUntil: location.bookedUntil,
      blockedReason: location.blockedReason,
      blockedFrom: location.blockedFrom,
      blockedUntil: location.blockedUntil,
      availabilityOverrides: location.availabilityOverrides
    }, periodStart, periodEnd))
    .map((location) => ({
      ...location,
      type: normalizeMediaType(location.type, location.category.name, location.address, location.code)
    }));
}

function salesRow(location: SalesReportLocation, index: number, periodStart: Date, periodEnd: Date) {
  const reservations = relevantReservations(location.reservations, periodStart, periodEnd);
  const sold = reservations.length > 0;
  const bodyStyle = index % 2 === 0 ? XLSX_STYLES.body : XLSX_STYLES.bodyAlt;
  const amount = roundMoney(
    reservations.reduce((sum, reservation) => {
      const monthlyAmount = reservationMonthlyAmount(reservation);
      return sum + calculateProrata(monthlyAmount, reservation.periodStart, reservation.periodEnd, periodStart, periodEnd).amount;
    }, 0)
  );
  const rateCardValue = location.rateCardValue ?? parseNumber(location.rateCard) ?? 0;
  const potentialAmount = sold
    ? amount
    : calculateProrata(rateCardValue, periodStart, periodEnd, periodStart, periodEnd).amount;

  return {
    sold,
    amount,
    potentialAmount,
    code: location.code,
    firstReservationStart: reservations[0]?.periodStart || null,
    firstReservationEnd: reservations[0]?.periodEnd || null,
    clientSort: reservations.map((reservation) => reservation.clientName).filter(Boolean).join(" "),
    campaignSort: reservations.map((reservation) => reservation.campaignName).filter(Boolean).join(" "),
    cells: [
      { value: index + 1, style: XLSX_STYLES.centered },
      { value: location.city || "", style: bodyStyle },
      { value: location.county || "", style: bodyStyle },
      { value: location.address || location.code, style: bodyStyle },
      { value: location.type || "", style: bodyStyle },
      { value: location.size || "", style: bodyStyle },
      { value: location.sqm ?? "", style: XLSX_STYLES.centered },
      { value: location.illum ? "Yes" : location.illum === false ? "No" : "", style: XLSX_STYLES.centered },
      { value: moneyCell(location.rateCardValue, location.rateCard), style: bodyStyle },
      { value: sold ? formatEuro(amount) : "", style: sold ? XLSX_STYLES.availabilityAvailable : bodyStyle },
      { value: reservations.length ? clientCell(reservations) : "", style: bodyStyle }
    ] satisfies StyledCell[]
  };
}

function relevantReservations(reservations: SalesReportReservation[], periodStart: Date, periodEnd: Date) {
  return reservations
    .filter((reservation) => reservation.status === "BOOKED")
    .filter((reservation) => overlaps(periodStart, periodEnd, new Date(reservation.periodStart), new Date(reservation.periodEnd)))
    .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime());
}

function titleRow(title: string, monthLabel: string): StyledCell[] {
  return Array.from({ length: modelHeaders.length }, (_, index) => ({
    value: index === 1 ? title : index === 10 ? monthLabel : "",
    style: index === 0 ? XLSX_STYLES.body : XLSX_STYLES.title
  }));
}

function emptyModelRow(): StyledCell[] {
  return blankCells(modelHeaders.length);
}

function modelHeaderRow(): StyledCell[] {
  return modelHeaders.map((header) => ({ value: header, style: XLSX_STYLES.header }));
}

function emptySummaryRow(): StyledCell[] {
  return blankCells(5);
}

function blankCells(count: number, style: number = XLSX_STYLES.body): StyledCell[] {
  return Array.from({ length: count }, () => ({ value: "", style }));
}

function clientCell(reservations: SalesReportReservation[]) {
  return reservations
    .map((reservation) => {
      const period = `${formatDate(new Date(reservation.periodStart))} - ${formatDate(new Date(reservation.periodEnd))}`;
      return [reservation.clientName, reservation.campaignName, period].filter(Boolean).join(" - ");
    })
    .join("\n");
}

function reservationMonthlyAmount(reservation: SalesReportReservation) {
  return reservation.amount ?? reservation.monthlyRentShare ?? (reservation.contractGroupId ? 0 : reservation.monthlyRentTotal ?? 0);
}

function totalsRow(
  countLabel: string,
  countValue: string,
  sumLabel: string,
  sumValue: number,
  valuePercent: number,
  valueStyle: number
): StyledCell[] {
  return [
    { value: countLabel, style: XLSX_STYLES.header },
    { value: "", style: XLSX_STYLES.header },
    { value: "", style: XLSX_STYLES.header },
    { value: countValue, style: XLSX_STYLES.centered },
    { value: "", style: XLSX_STYLES.centered },
    { value: "", style: XLSX_STYLES.centered },
    { value: sumLabel, style: XLSX_STYLES.header },
    { value: "", style: XLSX_STYLES.header },
    { value: "", style: XLSX_STYLES.header },
    { value: formatEuro(sumValue), style: valueStyle },
    { value: `(${percentLabel(valuePercent)} din pretul de vanzare)`, style: XLSX_STYLES.body }
  ];
}

function summaryRowMerges(row: number) {
  return [
    { startRow: row, startCol: 1, endRow: row, endCol: 3 },
    { startRow: row, startCol: 4, endRow: row, endCol: 6 },
    { startRow: row, startCol: 7, endRow: row, endCol: 9 }
  ];
}

function sortSalesLocations(a: SalesReportLocation, b: SalesReportLocation) {
  const aRank = salesReportReferenceRank.get(a.code);
  const bRank = salesReportReferenceRank.get(b.code);
  if (aRank != null || bRank != null) {
    if (aRank == null) return 1;
    if (bRank == null) return -1;
    if (aRank !== bRank) return aRank - bRank;
  }

  const aNr = numberOrNull(a.nr);
  const bNr = numberOrNull(b.nr);
  if (aNr != null && bNr != null && aNr !== bNr) return aNr - bNr;
  return sortOperationalLocations(a, b);
}

function sortSalesRows(
  a: ReturnType<typeof salesRow>,
  b: ReturnType<typeof salesRow>
) {
  const byGroup = salesRowTimingRank(a) - salesRowTimingRank(b);
  if (byGroup) return byGroup;
  const byStart = dateTimeOrMax(a.firstReservationStart) - dateTimeOrMax(b.firstReservationStart);
  if (byStart) return byStart;
  const byClient = a.clientSort.localeCompare(b.clientSort, "ro");
  if (byClient) return byClient;
  const byCampaign = a.campaignSort.localeCompare(b.campaignSort, "ro");
  if (byCampaign) return byCampaign;
  const aRank = salesReportReferenceRank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
  const bRank = salesReportReferenceRank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
  if (aRank !== bRank) return aRank - bRank;
  return a.code.localeCompare(b.code, "ro");
}

function salesRowTimingRank(row: ReturnType<typeof salesRow>) {
  if (!row.sold || !row.firstReservationStart || !row.firstReservationEnd) return 3;
  const today = startOfUtcDay(new Date());
  const start = startOfUtcDay(new Date(row.firstReservationStart));
  const end = startOfUtcDay(new Date(row.firstReservationEnd));
  if (start <= today && end >= today) return 0;
  if (start > today) return 1;
  return 2;
}

function dateTimeOrMax(value?: Date | string | null) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function numberOrNull(value?: string | null) {
  if (!value) return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function overlaps(from: Date, to: Date, periodStart: Date, periodEnd: Date) {
  return startOfUtcDay(periodStart) <= to && startOfUtcDay(periodEnd) >= from;
}

function parseDateParam(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function parseMonthParam(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from, to };
}

function currentMonthRange() {
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return { from, to };
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

function formatFileDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function moneyLabel(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    maximumFractionDigits: 2
  }).format(value);
}

function moneyCell(value?: number | null, fallback?: string | null) {
  const parsed = value ?? parseNumber(fallback);
  if (parsed == null) return fallback?.trim() || "";
  return formatEuro(parsed);
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

function percentLabel(value: number) {
  return new Intl.NumberFormat("ro-RO", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatEuro(value: number) {
  return `${moneyLabel(value)} \u20ac`;
}

function monthName(value: Date) {
  return new Intl.DateTimeFormat("ro-RO", {
    month: "long",
    timeZone: "UTC"
  })
    .format(value)
    .replace(/^./, (letter) => letter.toUpperCase());
}

function periodHeaderLabel(from: Date, to: Date) {
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return monthName(to);
  }
  return `${formatDate(from)} - ${formatDate(to)}`;
}
