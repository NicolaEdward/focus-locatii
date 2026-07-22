import { prisma } from "@/lib/prisma";
import { makeCode, normalizeMediaType, normalizeText, parseNumber, toBool } from "@/lib/format";
import { auditCoordinates, extractCoordinatesFromMapsUrl } from "@/lib/gps";
import { getOrCreateCategory } from "@/lib/locations";
import { googleDriveToViewUrl } from "@/lib/photos";
import { parseSecureSpreadsheet, type SafeSpreadsheetSheet } from "@/lib/secure-spreadsheet";
import { locationInputSchema } from "@/lib/validation";
import type { ImportSummary } from "@/types/location";

type RowMap = Record<string, unknown>;

type InventoryPlanRow = {
  sheetIndex: number;
  sheetName: string;
  rowIndex: number;
  code: string;
  data: ReturnType<typeof inventoryLocationData>;
};

const HEADER_ALIASES: Record<string, string[]> = {
  nr: ["nr", "no", "number", "#"],
  city: ["city", "oras", "oraș"],
  county: ["county", "judet", "județ"],
  address: ["address", "adresa", "adresă", "location"],
  type: ["type", "media type", "tip"],
  gps: ["gps", "google maps", "maps", "map"],
  photo: ["photo link", "photo", "poza", "poză", "image"],
  size: ["size", "dimensiune"],
  sqm: ["sqm", "mp", "surface", "surface area"],
  illum: ["illum", "illuminated", "iluminat", "lighting"],
  rateCard: ["rate card", "ratecard", "pret", "preț", "price"],
  installationRemoval: ["montare/neutralizare", "montare", "neutralizare", "installation & removal", "installation", "install", "montaj"],
  availability: ["availability", "disponibilitate", "status"]
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}#& ]/gu, "");
}

function canonicalKey(header: unknown) {
  const normalized = normalizeHeader(header);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }
  return normalized.replace(/\s+/g, "_");
}

function getCellValueOrHyperlink(sheet: SafeSpreadsheetSheet, rowIndex: number, colIndex: number, fallback: unknown) {
  const hyperlink = sheet.hyperlinks[cellAddress(rowIndex, colIndex)];
  return hyperlink || normalizeText(fallback) || "";
}

function cellAddress(rowIndex: number, colIndex: number) {
  let column = "";
  let current = colIndex + 1;
  while (current > 0) {
    column = String.fromCharCode(65 + ((current - 1) % 26)) + column;
    current = Math.floor((current - 1) / 26);
  }
  return `${column}${rowIndex + 1}`;
}

function statusFromAvailability(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "UNKNOWN" as const;
  if (/(ocupat|booked|reserved|rezervat|indisponibil|suspendat|suspended)/.test(text)) return "BOOKED" as const;
  if (/(from|din|incepand|începand|începând|\d{1,2}[./-]\d{1,2})/.test(text)) return "AVAILABLE_FROM" as const;
  if (/(available|disponibil|liber)/.test(text)) return "AVAILABLE" as const;
  return "UNKNOWN" as const;
}

function dateFromAvailability(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = match[3] ? normalizeYear(Number(match[3])) : new Date().getFullYear();
  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeYear(value: number) {
  return value < 100 ? 2000 + value : value;
}

function rowToObject(headers: string[], row: unknown[]): RowMap {
  const result = Object.create(null) as RowMap;
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (header && header !== "__proto__" && header !== "constructor" && header !== "prototype") result[header] = row[index];
  }
  return result;
}

function inventoryLocationData(input: {
  record: RowMap;
  sheetName: string;
  code: string;
  mapsUrl: string;
  photoOriginalUrl: string;
}) {
  const nr = normalizeText(input.record.nr);
  const city = normalizeText(input.record.city);
  const address = normalizeText(input.record.address);
  const coords = extractCoordinatesFromMapsUrl(input.mapsUrl);
  const audit = auditCoordinates({ city, lat: coords?.lat, lng: coords?.lng });
  const availabilityText = normalizeText(input.record.availability);
  const mainPhotoUrl = googleDriveToViewUrl(input.photoOriginalUrl);
  return {
    nr,
    code: input.code,
    city,
    county: normalizeText(input.record.county),
    address,
    type: normalizeMediaType(normalizeText(input.record.type), input.sheetName, address, input.code),
    size: normalizeText(input.record.size),
    sqm: parseNumber(input.record.sqm),
    illum: toBool(input.record.illum),
    rateCard: normalizeText(input.record.rateCard),
    rateCardValue: parseNumber(input.record.rateCard),
    installationRemoval: normalizeText(input.record.installationRemoval),
    installationRemovalValue: parseNumber(input.record.installationRemoval),
    availabilityText,
    latReal: coords?.lat ?? null,
    lngReal: coords?.lng ?? null,
    latDisplay: coords?.lat ?? null,
    lngDisplay: coords?.lng ?? null,
    mapsUrl: input.mapsUrl,
    mainPhotoUrl,
    photoOriginalUrl: input.photoOriginalUrl,
    showPricePublic: false,
    showInstallationCostPublic: true,
    showInPublic: true,
    isPremium: input.sheetName.toLowerCase().includes("aeroport"),
    isFeatured: false,
    coordinateSource: coords ? "google_maps_link" : "missing",
    gpsAuditStatus: audit.status,
    internalNotes: audit.status === "OK" ? null : audit.message
  };
}

function buildInventoryPlan(sheets: SafeSpreadsheetSheet[]) {
  const plan: InventoryPlanRow[] = [];
  const codes = new Set<string>();
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const rows = sheet.rows;
    const headerRowIndex = rows.findIndex((row) => row.some((cell) => ["nr", "address", "city", "gps"].includes(normalizeHeader(cell))));
    if (headerRowIndex === -1) continue;
    const headers = rows[headerRowIndex].map(canonicalKey);
    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const record = rowToObject(headers, rows[rowIndex]);
      const nr = normalizeText(record.nr);
      const address = normalizeText(record.address);
      const city = normalizeText(record.city);
      if (!nr && !address && !city) continue;
      const code = makeCode(sheet.name, nr, rowIndex);
      if (codes.has(code)) throw new Error(`Codul ${code} apare de mai multe ori în același import.`);
      codes.add(code);
      const gpsCol = headers.indexOf("gps");
      const photoCol = headers.indexOf("photo");
      const mapsUrl = gpsCol >= 0 ? getCellValueOrHyperlink(sheet, rowIndex, gpsCol, record.gps) : normalizeText(record.gps) || "";
      const photoOriginalUrl = photoCol >= 0 ? getCellValueOrHyperlink(sheet, rowIndex, photoCol, record.photo) : normalizeText(record.photo) || "";
      const data = inventoryLocationData({ record, sheetName: sheet.name, code, mapsUrl, photoOriginalUrl });
      locationInputSchema.parse({ ...data, categoryName: sheet.name });
      plan.push({ sheetIndex, sheetName: sheet.name, rowIndex, code, data });
    }
  }
  if (!plan.length) throw new Error("Fișierul nu conține rânduri de inventar valide.");
  return plan;
}

export async function importExcel(
  buffer: Buffer,
  fileName: string,
  importedBy?: string | null,
  mimeType?: string | null,
  signal?: AbortSignal
): Promise<ImportSummary> {
  const plan = await parseInventoryWorkbook({ buffer, fileName, mimeType, signal });
  const existingLocations = await prisma.location.findMany({
    where: { code: { in: plan.map((row) => row.code) } },
    select: { id: true, code: true }
  });
  const existingByCode = new Map(existingLocations.map((location) => [location.code, location]));
  const categories = new Map<string, Awaited<ReturnType<typeof getOrCreateCategory>>>();

  const batch = await prisma.importBatch.create({ data: { fileName, importedBy: importedBy || null } });
  let createdCount = 0;
  let updatedCount = 0;
  let missingGpsCount = 0;
  let suspectGpsCount = 0;
  let okGpsCount = 0;

  for (const row of plan) {
    let category = categories.get(row.sheetName);
    if (!category) {
      category = await getOrCreateCategory(row.sheetName, row.sheetIndex);
      categories.set(row.sheetName, category);
    }
    const existing = existingByCode.get(row.code);
    const data = { ...row.data, categoryId: category.id };
    const location = existing
      ? await prisma.location.update({ where: { id: existing.id }, data })
      : await prisma.location.create({ data });
    if (existing) updatedCount += 1;
    else createdCount += 1;

    if (row.data.gpsAuditStatus === "MISSING") missingGpsCount += 1;
    else if (row.data.gpsAuditStatus === "SUSPECT") suspectGpsCount += 1;
    else okGpsCount += 1;

    if (row.data.mainPhotoUrl) {
      await prisma.image.upsert({
        where: { id: `${location.id}-main` },
        update: { url: row.data.mainPhotoUrl, alt: `${row.code} photo`, isMain: true },
        create: { id: `${location.id}-main`, locationId: location.id, url: row.data.mainPhotoUrl, alt: `${row.code} photo`, isMain: true, sortOrder: 0 }
      });
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { totalRows: plan.length, createdCount, updatedCount, missingGpsCount, suspectGpsCount, okGpsCount }
  });
  return { batchId: batch.id, totalRows: plan.length, createdCount, updatedCount, missingGpsCount, suspectGpsCount, okGpsCount };
}

export async function parseInventoryWorkbook(input: { buffer: Buffer; fileName: string; mimeType?: string | null; signal?: AbortSignal }) {
  const workbook = await parseSecureSpreadsheet({
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    purpose: "inventory",
    allowedExtensions: ["xlsx", "xls"],
    raw: true,
    blankRows: true,
    signal: input.signal
  });
  return buildInventoryPlan(workbook.sheets);
}
