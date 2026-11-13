import { makeCode, normalizeMediaType, normalizeText, parseNumber, toBool } from "@/lib/format";
import { auditCoordinates, extractCoordinatesFromMapsUrl } from "@/lib/gps";
import { googleDriveToViewUrl } from "@/lib/photos";
import { parseSecureSpreadsheet, type SafeSpreadsheetSheet } from "@/lib/secure-spreadsheet";
import { locationInputSchema } from "@/lib/validation";
import { confirmInventoryImport, inventoryPayloadHash, previewInventoryImport, InventoryImportError, type InventoryImportActor, type InventoryImportOptions } from "@/lib/inventory-import";

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

export async function previewExcelImport(input: {
  buffer: Buffer; fileName: string; mimeType?: string | null; signal?: AbortSignal;
  actor: InventoryImportActor; options: InventoryImportOptions;
}) {
  const plan = await parseInventoryWorkbook(input);
  return previewInventoryImport({ rows: inventoryRows(plan), payloadHash: inventoryPayloadHash(input.buffer), actor: input.actor, options: input.options });
}

export async function confirmExcelImport(input: {
  buffer: Buffer; fileName: string; mimeType?: string | null; signal?: AbortSignal;
  actor: InventoryImportActor; options: InventoryImportOptions; previewToken: string;
}) {
  const plan = await parseInventoryWorkbook(input);
  return confirmInventoryImport({ rows: inventoryRows(plan), payloadHash: inventoryPayloadHash(input.buffer), fileName: input.fileName, actor: input.actor, options: input.options, previewToken: input.previewToken });
}

function inventoryRows(plan: InventoryPlanRow[]) {
  return plan.map((row) => ({ code: row.code, categoryName: row.sheetName, data: row.data, mainImage: row.data.mainPhotoUrl }));
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
  try { return buildInventoryPlan(workbook.sheets); }
  catch (error) {
    // The parser/planner only emits validation errors here, before any DB access.
    throw new InventoryImportError(error instanceof Error ? error.message : "Fișierul nu conține inventar valid.");
  }
}
