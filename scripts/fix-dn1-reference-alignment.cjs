const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DEFAULT_HTML = "C:/Users/edwar/Downloads/focus_media_client_gps_fixed.html";

const targetByCode = {
  PH029FLTA: "5",
  PH029FLTB: "6",
  PH031FLTA: "11",
  IF0692B: "12",
  PH031FLTB: "13"
};

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

async function main() {
  const dryRun = !process.argv.includes("--apply");
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

  const references = parseReferenceHtml(process.env.FOCUS_REFERENCE_HTML || DEFAULT_HTML)
    .filter((location) => location.category === "DN1")
    .reduce((acc, location) => {
      acc[String(location.nr)] = location;
      return acc;
    }, {});

  const changes = [];
  for (const [dbCode, referenceNr] of Object.entries(targetByCode)) {
    const reference = references[referenceNr];
    if (!reference) throw new Error(`Missing DN1 reference nr ${referenceNr}`);

    const [rows] = await connection.query(
      `
      SELECT l.id, l.code, l.nr, l.address
      FROM portfolio_locations l
      JOIN portfolio_categories c ON c.id = l.categoryId
      WHERE c.name = 'DN1' AND l.code = ?
      LIMIT 1
      `,
      [dbCode]
    );
    const row = rows[0];
    if (!row) throw new Error(`Missing DN1 database row ${dbCode}`);

    changes.push({
      code: dbCode,
      from: { nr: row.nr, address: row.address },
      to: { nr: reference.nr, address: reference.address }
    });

    if (dryRun) continue;

    const mainPhotoUrl = reference.photoUrl || null;
    await connection.query(
      `
      UPDATE portfolio_locations
      SET nr = ?, address = ?, city = ?, county = ?, type = ?, size = ?, sqm = ?,
          rateCard = ?, rateCardValue = ?, installationRemoval = ?, installationRemovalValue = ?,
          availabilityText = ?, status = ?, latReal = ?, lngReal = ?, latDisplay = ?, lngDisplay = ?,
          mapsUrl = ?, mainPhotoUrl = ?, photoOriginalUrl = ?, showPricePublic = TRUE,
          showInstallationCostPublic = TRUE, showInPublic = TRUE, coordinateSource = 'reference_html',
          gpsAuditStatus = 'OK', updatedAt = CURRENT_TIMESTAMP(3)
      WHERE id = ?
      `,
      [
        String(reference.nr),
        reference.address || null,
        reference.city || null,
        reference.county || null,
        reference.type || null,
        reference.size || null,
        Number(reference.sqm) || null,
        reference.rateCard == null ? null : String(reference.rateCard),
        Number(reference.rateCard) || null,
        reference.installation == null ? null : String(reference.installation),
        Number(reference.installation) || null,
        reference.availability || null,
        statusFromReference(reference.status, reference.availability),
        Number(reference.latReal ?? reference.lat) || null,
        Number(reference.lngReal ?? reference.lng) || null,
        Number(reference.latDisplay ?? reference.lat) || null,
        Number(reference.lngDisplay ?? reference.lng) || null,
        reference.mapsUrl || null,
        mainPhotoUrl,
        reference.photoOriginal || null,
        row.id
      ]
    );

    await connection.query("DELETE FROM portfolio_images WHERE locationId = ?", [row.id]);
    if (mainPhotoUrl) {
      await connection.query(
        `
        INSERT INTO portfolio_images (id, locationId, url, alt, sortOrder, isMain, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 0, TRUE, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE url = VALUES(url), alt = VALUES(alt), isMain = TRUE, updatedAt = CURRENT_TIMESTAMP(3)
        `,
        [`${row.id}-main`, row.id, mainPhotoUrl, `${dbCode} photo`]
      );
    }
  }

  await connection.end();
  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "applied", changes }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
