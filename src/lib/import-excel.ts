import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { makeCode, normalizeMediaType, normalizeText, parseNumber, toBool } from "@/lib/format";
import { auditCoordinates, extractCoordinatesFromMapsUrl } from "@/lib/gps";
import { getOrCreateCategory } from "@/lib/locations";
import { googleDriveToViewUrl } from "@/lib/photos";
import type { ImportSummary } from "@/types/location";

type RowMap = Record<string, unknown>;

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

function getCellHyperlink(sheet: XLSX.WorkSheet, rowIndex: number, colIndex: number) {
  const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[cellAddress] as XLSX.CellObject & { l?: { Target?: string } };
  return cell?.l?.Target || normalizeText(cell?.v);
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
  return headers.reduce<RowMap>((acc, header, index) => {
    if (header) acc[header] = row[index];
    return acc;
  }, {});
}

export async function importExcel(buffer: Buffer, fileName: string, importedBy?: string | null): Promise<ImportSummary> {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellHTML: false,
    cellStyles: true
  });

  const batch = await prisma.importBatch.create({
    data: { fileName, importedBy: importedBy || null }
  });

  let totalRows = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let missingGpsCount = 0;
  let suspectGpsCount = 0;
  let okGpsCount = 0;

  for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: ""
    });

    const headerRowIndex = rows.findIndex((row) =>
      row.some((cell) => ["nr", "address", "city", "gps"].includes(normalizeHeader(cell)))
    );
    if (headerRowIndex === -1) continue;

    const headers = rows[headerRowIndex].map(canonicalKey);
    const category = await getOrCreateCategory(sheetName, sheetIndex);

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const record = rowToObject(headers, row);
      const nr = normalizeText(record.nr);
      const address = normalizeText(record.address);
      const city = normalizeText(record.city);

      if (!nr && !address && !city) continue;

      totalRows += 1;

      const gpsCol = headers.indexOf("gps");
      const photoCol = headers.indexOf("photo");
      const mapsUrl = gpsCol >= 0 ? getCellHyperlink(sheet, rowIndex, gpsCol) : normalizeText(record.gps);
      const photoOriginalUrl = photoCol >= 0 ? getCellHyperlink(sheet, rowIndex, photoCol) : normalizeText(record.photo);
      const coords = extractCoordinatesFromMapsUrl(mapsUrl);
      const audit = auditCoordinates({ city, lat: coords?.lat, lng: coords?.lng });
      const code = makeCode(sheetName, nr, rowIndex);
      const existing = await prisma.location.findUnique({ where: { code } });
      const availabilityText = normalizeText(record.availability);
      const status = statusFromAvailability(availabilityText);
      const availabilityDate = dateFromAvailability(availabilityText);
      const mainPhotoUrl = googleDriveToViewUrl(photoOriginalUrl);

      if (audit.status === "MISSING") missingGpsCount += 1;
      else if (audit.status === "SUSPECT") suspectGpsCount += 1;
      else okGpsCount += 1;

      const data = {
        nr,
        code,
        categoryId: category.id,
        city,
        county: normalizeText(record.county),
        address,
        type: normalizeMediaType(normalizeText(record.type), sheetName, address, code),
        size: normalizeText(record.size),
        sqm: parseNumber(record.sqm),
        illum: toBool(record.illum),
        rateCard: normalizeText(record.rateCard),
        rateCardValue: parseNumber(record.rateCard),
        installationRemoval: normalizeText(record.installationRemoval),
        installationRemovalValue: parseNumber(record.installationRemoval),
        availabilityText,
        availableFrom: status === "AVAILABLE_FROM" ? availabilityDate : null,
        availableUntil: null,
        bookedFrom: null,
        bookedUntil: status === "BOOKED" ? availabilityDate : null,
        status,
        latReal: coords?.lat ?? null,
        lngReal: coords?.lng ?? null,
        latDisplay: coords?.lat ?? null,
        lngDisplay: coords?.lng ?? null,
        mapsUrl,
        mainPhotoUrl,
        photoOriginalUrl,
        showPricePublic: false,
        showInstallationCostPublic: true,
        showInPublic: true,
        isPremium: sheetName.toLowerCase().includes("aeroport"),
        isFeatured: false,
        coordinateSource: coords ? "google_maps_link" : "missing",
        gpsAuditStatus: audit.status,
        benefits: undefined,
        mediaDetails: undefined,
        campaignDetails: undefined,
        internalNotes: audit.status === "OK" ? null : audit.message
      };

      const location = existing
        ? await prisma.location.update({ where: { id: existing.id }, data })
        : await prisma.location.create({ data });

      if (existing) updatedCount += 1;
      else createdCount += 1;

      if (mainPhotoUrl) {
        await prisma.image.upsert({
          where: {
            id: `${location.id}-main`
          },
          update: {
            url: mainPhotoUrl,
            alt: `${code} photo`,
            isMain: true
          },
          create: {
            id: `${location.id}-main`,
            locationId: location.id,
            url: mainPhotoUrl,
            alt: `${code} photo`,
            isMain: true,
            sortOrder: 0
          }
        });
      }
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      totalRows,
      createdCount,
      updatedCount,
      missingGpsCount,
      suspectGpsCount,
      okGpsCount
    }
  });

  return {
    batchId: batch.id,
    totalRows,
    createdCount,
    updatedCount,
    missingGpsCount,
    suspectGpsCount,
    okGpsCount
  };
}
