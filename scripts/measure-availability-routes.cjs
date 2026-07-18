const fs = require("node:fs");
const path = require("node:path");

loadEnvFile(process.env.ENV_FILE);

const baseUrl = String(process.env.MEASURE_BASE_URL || "http://localhost:3015").replace(/\/$/, "");
const email = process.env.MEASURE_EMAIL || "coo.preview@focusmedia.test";
const password = process.env.PREVIEW_TEST_PASSWORD;
const runs = Math.max(1, Math.min(Number(process.env.MEASURE_RUNS || 3), 10));
if (!password) throw new Error("PREVIEW_TEST_PASSWORD is missing.");

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});

async function main() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!login.ok) throw new Error(`Login returned ${login.status}.`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Session cookie is missing.");

  const selector = await fetchJson("/api/admin/location-selection", { headers: { cookie } });
  const locationIds = selector.payload.locations.map((row) => row.id).slice(0, 500);
  if (!locationIds.length) throw new Error("Selector returned no locations.");

  const cases = [
    { name: "public_locations", route: "/api/locations", options: {} },
    { name: "selector_list", route: "/api/admin/location-selection", options: { headers: { cookie } } },
    {
      name: "selector_availability",
      route: "/api/admin/location-selection/availability",
      options: mutationOptions(cookie, { locationIds, periodStart: "2026-08-01", periodEnd: "2026-08-31" })
    },
    {
      name: "conflict_preview",
      route: "/api/admin/reservations/conflict-preview",
      options: mutationOptions(cookie, { locationIds: locationIds.slice(0, 100), periodStart: "2026-08-01", periodEnd: "2026-08-31" })
    }
  ];

  const results = [];
  for (const testCase of cases) {
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}${testCase.route}`, testCase.options);
      const body = await response.arrayBuffer();
      const durationMs = performance.now() - started;
      if (!response.ok) throw new Error(`${testCase.name} returned ${response.status}: ${Buffer.from(body).toString("utf8").slice(0, 300)}`);
      samples.push({ durationMs: round(durationMs), responseBytes: body.byteLength });
    }
    const ordered = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    results.push({
      name: testCase.name,
      runs,
      medianMs: ordered[Math.floor(ordered.length / 2)],
      minMs: ordered[0],
      maxMs: ordered.at(-1),
      responseBytes: samples.at(-1).responseBytes,
      samples
    });
  }

  console.log(JSON.stringify({ ok: true, baseUrl, locationCount: locationIds.length, readOnly: true, results }, null, 2));
}

function mutationOptions(cookie, body) {
  return {
    method: "POST",
    headers: { cookie, origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

async function fetchJson(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${route} returned ${response.status}.`);
  return { response, payload };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function loadEnvFile(fileName) {
  if (!fileName) return;
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Environment file does not exist: ${filePath}`);
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}
