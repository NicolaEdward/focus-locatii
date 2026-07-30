const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const BASE_URL = process.env.LIVE_SMOKE_URL || "https://locatii.focusmedia.ro";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    const contents = fs.readFileSync(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();

  const health = await fetch(`${BASE_URL}/api/health/db`).then((response) => response.json());
  assert(health.ok === true || health.status === "ok", "Live database health failed");

  const payload = await fetch(`${BASE_URL}/api/locations`).then((response) => response.json());
  const locations = Array.isArray(payload) ? payload : payload.locations || [];
  assert(locations.length >= 1, `Live public locations are missing: ${locations.length}`);
  assert(
    locations.every((location) => location.reservations == null || (Array.isArray(location.reservations) && location.reservations.length === 0)),
    "Live public locations API exposes reservations"
  );
  assert(locations.every((location) => !location.rateCard && !location.rateCardValue), "Live public API exposes hidden rate card");

  const blockedExport = await fetch(`${BASE_URL}/api/admin/availability/excel`);
  assert(blockedExport.status === 401, "Live admin availability export is not protected");

  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    })
  });
  assert(login.ok, "Live admin login failed");

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Live admin login did not return session cookie");

  const adminExport = await fetch(`${BASE_URL}/api/admin/availability/excel`, {
    headers: { cookie }
  });
  assert(adminExport.ok, "Live admin availability export failed");

  const workbook = XLSX.read(Buffer.from(await adminExport.arrayBuffer()), { type: "buffer" });
  assert(workbook.SheetNames.length > 0, "Live admin export has no sheets");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: ""
  });
  const headerRow = rows.find(
    (row) => row[0] === "Nr" && row[12] === "Schita" && row[13] === "Availability"
  );
  assert(headerRow, "Live admin export headers mismatch");

  const publicPage = await fetch(`${BASE_URL}/locatii`).then((response) => response.text());
  assert(publicPage.includes("Focus Media") || publicPage.includes("PORTOFOLIU"), "Live public page content missing");

  console.log(
    JSON.stringify(
      {
        ok: true,
        domain: BASE_URL,
        locations: locations.length,
        adminExportSheets: workbook.SheetNames.length
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
