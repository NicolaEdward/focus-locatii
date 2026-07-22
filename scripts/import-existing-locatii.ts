import mysql from "mysql2/promise";
import { prisma } from "../src/lib/prisma";
import { makeCode, normalizeText, toBool } from "../src/lib/format";
import { auditCoordinates, extractCoordinatesFromMapsUrl } from "../src/lib/gps";
import { getOrCreateCategory } from "../src/lib/locations";
import { googleDriveToViewUrl } from "../src/lib/photos";
import { loadLocalEnv } from "./load-env";
import { mysqlOptions } from "./mysql-options";

type LegacyRow = {
  id: number;
  city?: string | null;
  county?: string | null;
  address?: string | null;
  type?: string | null;
  gps?: string | null;
  code?: string | null;
  size?: string | null;
  photo_link?: string | null;
  sqm?: number | null;
  illumination?: string | null;
  ratecard?: number | null;
  decoration_cost?: number | null;
  observatii?: string | null;
  status?: string | null;
  data_start?: string | null;
  data_end?: string | null;
  grup?: string | null;
  face?: string | null;
};

async function main() {
  loadLocalEnv();
  const connection = await mysql.createConnection(mysqlOptions());

  const [rows] = await connection.query("SELECT * FROM locatii ORDER BY id ASC");
  await connection.end();

  const seenCodes = new Set<string>();
  let created = 0;
  let updated = 0;
  let missingGps = 0;
  let suspectGps = 0;

  for (const row of rows as LegacyRow[]) {
    const categoryName = normalizeText(row.grup) || "General";
    const category = await getOrCreateCategory(categoryName);
    const baseCode = makeCode(categoryName, normalizeText(row.code) || row.id, row.id);
    const code = seenCodes.has(baseCode) ? `${baseCode}-${row.id}` : baseCode;
    seenCodes.add(code);

    const coords = extractCoordinatesFromMapsUrl(row.gps);
    const audit = auditCoordinates({ city: row.city, lat: coords?.lat, lng: coords?.lng });
    if (audit.status === "MISSING") missingGps += 1;
    if (audit.status === "SUSPECT") suspectGps += 1;

    const existing = await prisma.location.findUnique({ where: { code } });
    const mainPhotoUrl = googleDriveToViewUrl(row.photo_link);
    const data = {
      nr: String(row.id),
      code,
      categoryId: category.id,
      city: normalizeText(row.city),
      county: normalizeText(row.county),
      address: normalizeText(row.address),
      type: normalizeText(row.type),
      size: normalizeText(row.size),
      sqm: row.sqm == null ? null : Number(row.sqm),
      illum: toBool(row.illumination),
      rateCard: row.ratecard == null ? null : String(row.ratecard),
      rateCardValue: row.ratecard == null ? null : Number(row.ratecard),
      installationRemoval: row.decoration_cost == null ? null : String(row.decoration_cost),
      installationRemovalValue: row.decoration_cost == null ? null : Number(row.decoration_cost),
      availabilityText: normalizeText(row.status) || normalizeText(row.data_start),
      latReal: coords?.lat ?? null,
      lngReal: coords?.lng ?? null,
      latDisplay: coords?.lat ?? null,
      lngDisplay: coords?.lng ?? null,
      mapsUrl: normalizeText(row.gps),
      mainPhotoUrl,
      photoOriginalUrl: normalizeText(row.photo_link),
      showPricePublic: false,
      showInstallationCostPublic: false,
      showInPublic: true,
      isPremium: categoryName.toLowerCase().includes("aeroport"),
      isFeatured: false,
      coordinateSource: coords ? "legacy_locatii.gps" : "missing",
      gpsAuditStatus: audit.status,
      internalNotes: normalizeText(row.observatii),
      mediaDetails: [
        row.type ? `Format: ${row.type}` : null,
        row.size ? `Size: ${row.size}` : null,
        row.face ? `Face: ${row.face}` : null
      ].filter(Boolean) as string[]
    };

    const location = existing
      ? await prisma.location.update({ where: { id: existing.id }, data })
      : await prisma.location.create({ data });

    if (existing) updated += 1;
    else created += 1;

    if (mainPhotoUrl) {
      await prisma.image.upsert({
        where: { id: `${location.id}-main` },
        update: { url: mainPhotoUrl, alt: code, isMain: true },
        create: {
          id: `${location.id}-main`,
          locationId: location.id,
          url: mainPhotoUrl,
          alt: code,
          sortOrder: 0,
          isMain: true
        }
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        total: (rows as LegacyRow[]).length,
        created,
        updated,
        missingGps,
        suspectGps
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
