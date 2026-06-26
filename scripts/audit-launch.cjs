const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const XLSX = require("xlsx");

const DEFAULT_HTML = "C:/Users/edwar/Downloads/focus_media_client_gps_fixed.html";
const DEFAULT_XLSX = "C:/Users/edwar/Desktop/Sales/SkyCop[/Disponibil Focus Media.xlsx";

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseReferenceHtml(file) {
  if (!fs.existsSync(file)) return { exists: false, locations: [] };
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(/const LOCATIONS=(\[[\s\S]*?\]);\s*const WHATSAPP/);
  if (!match) return { exists: true, locations: [], error: "LOCATIONS array not found" };
  return { exists: true, locations: JSON.parse(match[1]) };
}

function getCellHyperlink(sheet, rowIndex, colIndex) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[address];
  return cell?.l?.Target || String(cell?.v ?? "").trim();
}

function parseWorkbook(file) {
  if (!fs.existsSync(file)) return { exists: false, rows: [] };
  const workbook = XLSX.readFile(file, { cellDates: true, cellHTML: false, cellStyles: true });
  const rows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headerIndex = table.findIndex((row) =>
      row.some((cell) => ["nr", "address", "city", "gps"].includes(normalize(cell)))
    );
    if (headerIndex < 0) continue;

    const headers = table[headerIndex].map((header) => normalize(header));
    const gpsCol = headers.indexOf("gps");
    const photoCol = headers.indexOf("photo link");

    for (let i = headerIndex + 1; i < table.length; i += 1) {
      const row = table[i];
      const record = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
      const nr = String(record.nr ?? "").trim();
      const city = String(record.city ?? "").trim();
      const address = String(record.address ?? "").trim();
      if (!nr && !city && !address) continue;
      rows.push({
        sheetName,
        nr,
        city,
        county: String(record.county ?? "").trim(),
        address,
        type: String(record.type ?? "").trim(),
        gps: gpsCol >= 0 ? getCellHyperlink(sheet, i, gpsCol) : String(record.gps ?? "").trim(),
        photo: photoCol >= 0 ? getCellHyperlink(sheet, i, photoCol) : String(record["photo link"] ?? "").trim(),
        size: String(record.size ?? "").trim(),
        sqm: Number(record.sqm) || null,
        rateCard: Number(record["rate card"]) || null,
        availability: String(record.availability ?? "").trim()
      });
    }
  }

  return { exists: true, rows };
}

function distanceKm(a, b) {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return r * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function coordinatesIssues(rows) {
  const cityCenters = {
    bucuresti: { lat: 44.4268, lng: 26.1025 },
    otopeni: { lat: 44.5711, lng: 26.085 },
    giurgiu: { lat: 43.9037, lng: 25.9699 },
    timisoara: { lat: 45.7489, lng: 21.2087 },
    baicoi: { lat: 45.0333, lng: 25.85 },
    bragadiru: { lat: 44.3711, lng: 25.9775 },
    jilava: { lat: 44.3333, lng: 26.0781 },
    mogosoaia: { lat: 44.5292, lng: 26.0007 },
    balotesti: { lat: 44.6167, lng: 26.1167 }
  };

  return rows
    .map((row) => {
      const lat = Number(row.latDisplay ?? row.latReal);
      const lng = Number(row.lngDisplay ?? row.lngReal);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { code: row.code, city: row.city, address: row.address, issue: "missing gps" };
      }
      if (lat < 43.4 || lat > 48.4 || lng < 20.1 || lng > 29.9) {
        return { code: row.code, city: row.city, address: row.address, issue: "outside Romania", lat, lng };
      }
      const center = cityCenters[normalize(row.city || "")];
      if (center) {
        const km = distanceKm(center, { lat, lng });
        if (km > 85) {
          return { code: row.code, city: row.city, address: row.address, issue: "far from city", km: Math.round(km), lat, lng };
        }
      }
      return null;
    })
    .filter(Boolean);
}

function summarizeDb(rows) {
  return {
    count: rows.length,
    statusCounts: rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
    hiddenPrice: rows.filter((row) => !row.showPricePublic).length,
    hiddenInstall: rows.filter((row) => !row.showInstallationCostPublic).length,
    missingRate: rows.filter((row) => row.rateCard == null && row.rateCardValue == null).length,
    missingAvailability: rows.filter((row) => !row.availabilityText).length,
    missingGps: rows.filter((row) => row.latDisplay == null || row.lngDisplay == null).length,
    missingMainPhoto: rows.filter((row) => !row.mainPhotoUrl).length,
    noImages: rows.filter((row) => !row.imageCount).length
  };
}

function compareByAddress(dbRows, referenceRows) {
  const dbByNr = new Map(dbRows.map((row) => [`${normalize(row.category)}|${normalize(row.nr)}`, row]));
  const dbByAddress = new Map();
  for (const row of dbRows) {
    const key = `${normalize(row.category)}|${normalize(row.address)}`;
    if (!dbByAddress.has(key)) dbByAddress.set(key, row);
  }
  const missingInDb = [];
  const mismatches = [];

  for (const reference of referenceRows) {
    const nrKey = `${normalize(reference.category)}|${normalize(reference.nr)}`;
    const addressKey = `${normalize(reference.category)}|${normalize(reference.address)}`;
    const db = dbByNr.get(nrKey) || dbByAddress.get(addressKey);
    if (!db) {
      missingInDb.push({
        category: reference.category,
        code: reference.code,
        address: reference.address
      });
      continue;
    }
    const dbRate = Number(db.rateCardValue ?? db.rateCard);
    const refRate = Number(reference.rateCard);
    const issues = [];
    if (Number.isFinite(refRate) && Math.abs((Number.isFinite(dbRate) ? dbRate : 0) - refRate) > 0.01) issues.push("rateCard");
    if (normalize(db.availabilityText) !== normalize(reference.availability)) issues.push("availability");
    if (reference.photoUrl && normalize(db.mainPhotoUrl) !== normalize(reference.photoUrl) && normalize(db.photoOriginalUrl) !== normalize(reference.photoOriginal)) {
      issues.push("photo");
    }
    if (issues.length) {
      mismatches.push({
        code: db.code,
        referenceCode: reference.code,
        category: reference.category,
        address: reference.address,
        issues
      });
    }
  }

  return {
    missingInDb: missingInDb.slice(0, 30),
    missingInDbCount: missingInDb.length,
    mismatches: mismatches.slice(0, 50),
    mismatchCount: mismatches.length
  };
}

async function main() {
  const env = {
    ...loadEnv(path.join(process.cwd(), ".env")),
    ...loadEnv(path.join(process.cwd(), ".env.local"))
  };

  const dbUrl = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  const connection = await mysql.createConnection({
    host: dbUrl?.hostname || env.MYSQL_HOST,
    port: Number(dbUrl?.port || env.MYSQL_PORT || 3306),
    user: dbUrl ? decodeURIComponent(dbUrl.username) : env.MYSQL_USER,
    password: dbUrl ? decodeURIComponent(dbUrl.password) : env.MYSQL_PASSWORD,
    database: dbUrl ? dbUrl.pathname.replace(/^\//, "") : env.MYSQL_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  const [dbRows] = await connection.query(`
    SELECT
      l.id, l.nr, l.code, c.name AS category, l.city, l.county, l.address, l.type,
      l.size, l.sqm, l.illum, l.rateCard, l.rateCardValue, l.installationRemoval,
      l.installationRemovalValue, l.availabilityText, l.status, l.showPricePublic,
      l.showInstallationCostPublic, l.mainPhotoUrl, l.photoOriginalUrl, l.mapsUrl,
      l.latReal, l.lngReal, l.latDisplay, l.lngDisplay,
      (SELECT COUNT(*) FROM portfolio_images i WHERE i.locationId = l.id) AS imageCount
    FROM portfolio_locations l
    JOIN portfolio_categories c ON c.id = l.categoryId
    ORDER BY c.sortOrder, c.name, l.code
  `);
  await connection.end();

  const html = parseReferenceHtml(process.env.FOCUS_REFERENCE_HTML || DEFAULT_HTML);
  const workbook = parseWorkbook(process.env.FOCUS_REFERENCE_XLSX || DEFAULT_XLSX);
  const comparison = html.locations.length ? compareByAddress(dbRows, html.locations) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    database: summarizeDb(dbRows),
    coordinateIssues: coordinatesIssues(dbRows).slice(0, 50),
    coordinateIssueCount: coordinatesIssues(dbRows).length,
    referenceHtml: {
      exists: html.exists,
      count: html.locations.length,
      missingGps: html.locations.filter((row) => row.latDisplay == null || row.lngDisplay == null).length,
      missingPhoto: html.locations.filter((row) => !row.photoUrl).length,
      missingRate: html.locations.filter((row) => !row.rateCard).length,
      statusCounts: html.locations.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {})
    },
    referenceWorkbook: {
      exists: workbook.exists,
      count: workbook.rows.length,
      sheets: [...new Set(workbook.rows.map((row) => row.sheetName))],
      missingGps: workbook.rows.filter((row) => !row.gps || row.gps === "Maps").length,
      missingPhoto: workbook.rows.filter((row) => !row.photo || row.photo === "Photo").length,
      missingRate: workbook.rows.filter((row) => !row.rateCard).length
    },
    comparison
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
