const fs = require("fs");
const path = require("path");
const accounts = require("./preview-accounts.json");

loadEnvFile(process.env.ENV_FILE);

const baseUrl = String(process.env.MEASURE_BASE_URL || "http://127.0.0.1:3022").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD;
const maxListBytes = Number(process.env.WORKSPACE_LIST_BUDGET_BYTES || 100_000);

if (!password) throw new Error("PREVIEW_TEST_PASSWORD lipsește.");

async function main() {
  const account = accounts.find((item) => item.role === "COO");
  if (!account) throw new Error("Contul sintetic COO lipsește.");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password }),
    redirect: "manual",
  });
  if (!login.ok) throw new Error(`Login eșuat: ${login.status}.`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Cookie-ul sesiunii lipsește.");

  const results = [];
  for (const route of ["/admin/clienti", "/admin/campanii", "/api/admin/clients?limit=30", "/api/admin/campaigns?limit=30"]) {
    results.push(await measure(route, cookie, 3));
  }

  const clients = await requestJson("/api/admin/clients?limit=30", cookie);
  const campaigns = await requestJson("/api/admin/campaigns?limit=30", cookie);
  const clientId = clients.page?.items?.[0]?.id || clients.clients?.[0]?.id;
  const campaignId = campaigns.page?.items?.[0]?.id || campaigns.campaigns?.[0]?.id;
  if (!clientId || !campaignId) throw new Error("Datele sintetice nu conțin clientul și campania necesare smoke-ului.");

  for (const route of [
    `/api/admin/clients/${clientId}`,
    `/api/admin/clients/${clientId}/contacts`,
    `/api/admin/clients/${clientId}/documents`,
    `/api/admin/clients/${clientId}/campaigns`,
    `/api/admin/clients/${clientId}/finance`,
    `/api/admin/campaigns/${campaignId}`,
    `/api/admin/campaigns/${campaignId}/reservations`,
    `/api/admin/campaigns/${campaignId}/documents`,
    `/api/admin/campaigns/${campaignId}/finance`,
  ]) {
    results.push(await measure(route, cookie, 1));
  }

  const listResults = results.filter((item) => item.route.startsWith("/api/admin/clients?") || item.route.startsWith("/api/admin/campaigns?"));
  const oversized = listResults.filter((item) => item.bytes > maxListBytes);
  if (oversized.length) throw new Error(`Buget listă depășit: ${oversized.map((item) => `${item.route}=${item.bytes}`).join(", ")}`);

  console.log(JSON.stringify({ ok: true, baseUrl, maxListBytes, results }, null, 2));
}

async function measure(route, cookie, runs) {
  const samplesMs = [];
  let bytes = 0;
  let status = 0;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}${route}`, { headers: { cookie }, redirect: "manual" });
    const body = Buffer.from(await response.arrayBuffer());
    samplesMs.push(Math.round(performance.now() - started));
    bytes = body.length;
    status = response.status;
    if (!response.ok) throw new Error(`${route} a răspuns ${response.status}: ${body.toString("utf8", 0, 200)}`);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return { route, status, bytes, medianMs: sorted[Math.floor(sorted.length / 2)], samplesMs };
}

async function requestJson(route, cookie) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { cookie }, redirect: "manual" });
  if (!response.ok) throw new Error(`${route} a răspuns ${response.status}.`);
  return response.json();
}

function loadEnvFile(fileName) {
  if (!fileName) return;
  const filePath = path.resolve(process.cwd(), fileName);
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
