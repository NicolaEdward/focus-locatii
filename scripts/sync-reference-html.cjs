const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DEFAULT_HTML = "C:/Users/edwar/Downloads/focus_media_client_gps_fixed.html";

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
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
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(/const LOCATIONS=(\[[\s\S]*?\]);\s*const WHATSAPP/);
  if (!match) throw new Error("LOCATIONS array not found in reference HTML");
  return JSON.parse(match[1]);
}

function statusFromReference(status, availability) {
  const text = String(availability || "").toLowerCase();
  if (status === "soon" || /(din|from|\d{1,2}[./-]\d{1,2})/.test(text)) return "AVAILABLE_FROM";
  if (status === "available" || /disponibil|available/.test(text)) return "AVAILABLE";
  if (/ocupat|booked|reserved|rezervat|indisponibil/.test(text)) return "BOOKED";
  return "UNKNOWN";
}

function boolFromReference(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["yes", "da", "true", "1"].includes(text)) return 1;
  if (["no", "nu", "false", "0"].includes(text)) return 0;
  return null;
}

function addToIndex(index, key, value) {
  if (!key) return;
  const current = index.get(key) || [];
  current.push(value);
  index.set(key, current);
}

function uniqueFrom(index, key) {
  const rows = index.get(key) || [];
  return rows.length === 1 ? rows[0] : null;
}

function matchReference(reference, indexes, referenceAddressGroups) {
  const addressKey = `${normalize(reference.category)}|${normalize(reference.address)}`;
  const dbAddressGroup = indexes.byCategoryAddress.get(addressKey) || [];
  const referenceAddressGroup = referenceAddressGroups.get(addressKey) || [];
  const ordinalAddressMatch =
    dbAddressGroup.length > 1 && dbAddressGroup.length === referenceAddressGroup.length
      ? dbAddressGroup[referenceAddressGroup.indexOf(reference)]
      : null;

  return (
    uniqueFrom(indexes.byCategoryNr, `${normalize(reference.category)}|${normalize(reference.nr)}`) ||
    uniqueFrom(indexes.byCategoryAddress, `${normalize(reference.category)}|${normalize(reference.address)}`) ||
    ordinalAddressMatch ||
    uniqueFrom(indexes.byCode, normalize(reference.code))
  );
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const referenceFile = process.env.FOCUS_REFERENCE_HTML || DEFAULT_HTML;
  const references = parseReferenceHtml(referenceFile);
  const env = {
    ...loadEnv(path.join(process.cwd(), ".env")),
    ...loadEnv(path.join(process.cwd(), ".env.local"))
  };
  const url = new URL(env.DATABASE_URL);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false }
  });

  const [dbRows] = await connection.query(`
    SELECT l.id, l.nr, l.code, c.name AS category, l.address
    FROM portfolio_locations l
    JOIN portfolio_categories c ON c.id = l.categoryId
    ORDER BY c.name, l.address, l.nr, l.code
  `);

  const indexes = {
    byCategoryNr: new Map(),
    byCategoryAddress: new Map(),
    byCode: new Map()
  };

  for (const row of dbRows) {
    addToIndex(indexes.byCategoryNr, `${normalize(row.category)}|${normalize(row.nr)}`, row);
    addToIndex(indexes.byCategoryAddress, `${normalize(row.category)}|${normalize(row.address)}`, row);
    addToIndex(indexes.byCode, normalize(row.code), row);
  }

  const referenceAddressGroups = new Map();
  for (const reference of references) {
    addToIndex(referenceAddressGroups, `${normalize(reference.category)}|${normalize(reference.address)}`, reference);
  }

  let matched = 0;
  let updated = 0;
  const skipped = [];
  const changes = [];

  for (const reference of references) {
    const db = matchReference(reference, indexes, referenceAddressGroups);
    if (!db) {
      skipped.push({ code: reference.code, category: reference.category, nr: reference.nr, address: reference.address });
      continue;
    }

    matched += 1;
    const data = {
      nr: reference.nr == null ? null : String(reference.nr),
      city: reference.city || null,
      county: reference.county || null,
      address: reference.address || null,
      type: reference.type || null,
      size: reference.size || null,
      sqm: Number(reference.sqm) || null,
      illum: boolFromReference(reference.illum),
      rateCard: reference.rateCard == null ? null : String(reference.rateCard),
      rateCardValue: Number(reference.rateCard) || null,
      installationRemoval: reference.installation == null ? null : String(reference.installation),
      installationRemovalValue: Number(reference.installation) || null,
      availabilityText: reference.availability || null,
      status: statusFromReference(reference.status, reference.availability),
      latReal: Number(reference.latReal ?? reference.lat) || null,
      lngReal: Number(reference.lngReal ?? reference.lng) || null,
      latDisplay: Number(reference.latDisplay ?? reference.lat) || null,
      lngDisplay: Number(reference.lngDisplay ?? reference.lng) || null,
      mapsUrl: reference.mapsUrl || null,
      mainPhotoUrl: reference.photoUrl || null,
      photoOriginalUrl: reference.photoOriginal || null,
      showPricePublic: 1,
      showInstallationCostPublic: 1,
      showInPublic: 1,
      coordinateSource: reference.coordinateSource || "reference_html",
      gpsAuditStatus: "OK"
    };

    changes.push({ dbCode: db.code, referenceCode: reference.code, id: db.id, address: data.address });

    if (!dryRun) {
      await connection.query(
        `
        UPDATE portfolio_locations
        SET nr = ?, city = ?, county = ?, address = ?, type = ?, size = ?, sqm = ?, illum = ?,
            rateCard = ?, rateCardValue = ?, installationRemoval = ?, installationRemovalValue = ?,
            availabilityText = ?, status = ?, latReal = ?, lngReal = ?, latDisplay = ?, lngDisplay = ?,
            mapsUrl = ?, mainPhotoUrl = ?, photoOriginalUrl = ?, showPricePublic = ?,
            showInstallationCostPublic = ?, showInPublic = ?, coordinateSource = ?, gpsAuditStatus = ?,
            updatedAt = CURRENT_TIMESTAMP(3)
        WHERE id = ?
        `,
        [
          data.nr,
          data.city,
          data.county,
          data.address,
          data.type,
          data.size,
          data.sqm,
          data.illum,
          data.rateCard,
          data.rateCardValue,
          data.installationRemoval,
          data.installationRemovalValue,
          data.availabilityText,
          data.status,
          data.latReal,
          data.lngReal,
          data.latDisplay,
          data.lngDisplay,
          data.mapsUrl,
          data.mainPhotoUrl,
          data.photoOriginalUrl,
          data.showPricePublic,
          data.showInstallationCostPublic,
          data.showInPublic,
          data.coordinateSource,
          data.gpsAuditStatus,
          db.id
        ]
      );

      if (data.mainPhotoUrl) {
        await connection.query(
          `
          INSERT INTO portfolio_images (id, locationId, url, alt, sortOrder, isMain, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 0, TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE url = VALUES(url), alt = VALUES(alt), isMain = TRUE, updatedAt = CURRENT_TIMESTAMP(3)
          `,
          [`${db.id}-main`, db.id, data.mainPhotoUrl, `${db.code} photo`]
        );
      }

      updated += 1;
    }
  }

  if (!dryRun) {
    await connection.query(`
      UPDATE portfolio_locations
      SET showPricePublic = TRUE
      WHERE rateCard IS NOT NULL OR rateCardValue IS NOT NULL
    `);
    await connection.query(`
      UPDATE portfolio_locations
      SET showInstallationCostPublic = TRUE
      WHERE installationRemoval IS NOT NULL OR installationRemovalValue IS NOT NULL
    `);
    await connection.query(`
      UPDATE portfolio_locations
      SET status = CASE
        WHEN LOWER(COALESCE(availabilityText, '')) REGEXP 'ocupat|booked|reserved|rezervat|indisponibil' THEN 'BOOKED'
        WHEN LOWER(COALESCE(availabilityText, '')) REGEXP 'din|from|[0-9]{1,2}[./-][0-9]{1,2}' THEN 'AVAILABLE_FROM'
        WHEN LOWER(COALESCE(availabilityText, '')) REGEXP 'disponibil|available|liber' THEN 'AVAILABLE'
        ELSE status
      END
    `);
  }

  await connection.end();

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "applied",
        referenceCount: references.length,
        matched,
        updated,
        skippedCount: skipped.length,
        skipped: skipped.slice(0, 30),
        sampleChanges: changes.slice(0, 20)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
