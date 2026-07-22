const fs = require("node:fs");
const path = require("node:path");
const accounts = require("./preview-accounts.json");

loadEnvFile(process.env.ENV_FILE);
const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3015").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD;
const vercelShareToken = process.env.VERCEL_SHARE_TOKEN;
let vercelShareCookie = null;
if (!password) throw new Error("PREVIEW_TEST_PASSWORD is missing.");

const adminRoutes = [
  "/admin/dashboard",
  "/admin/locatii",
  "/admin/selectie-locatii",
  "/admin/clienti",
  "/admin/campanii",
  "/admin/crm",
  "/admin/operational",
  "/admin/financiar/incasari",
  "/admin/integrari/saga",
  "/admin/furnizori",
  "/admin/locatii/import",
  "/admin/locatii/gps",
  "/admin/utilizatori",
  "/admin/integritate-date",
  "/admin/securitate",
];
const expectedDashboard = {
  COO: "/admin/dashboard",
  SALES_DIRECTOR: "/admin/dashboard",
  SALES_AGENT: "/admin/dashboard",
  FINANCE_OPERATOR: "/admin/financiar/incasari",
  FIELD_OPERATOR: "/admin/operational",
};
const allowed = {
  COO: new Set(adminRoutes),
  SALES_DIRECTOR: new Set(adminRoutes.filter((route) => !["/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/locatii/import", "/admin/locatii/gps", "/admin/utilizatori", "/admin/integritate-date"].includes(route))),
  SALES_AGENT: new Set(adminRoutes.filter((route) => !["/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/locatii/import", "/admin/locatii/gps", "/admin/utilizatori", "/admin/integritate-date"].includes(route))),
  FINANCE_OPERATOR: new Set(["/admin/clienti", "/admin/campanii", "/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/securitate"]),
  FIELD_OPERATOR: new Set(["/admin/operational", "/admin/securitate"]),
};

async function main() {
  await ensureVercelShareCookie();
  const health = await request("/api/health/db");
  assert(health.status === 200, `DB health returned ${health.status}.`);

  for (const route of adminRoutes) {
    const response = await request(route, { redirect: "manual" });
    const target = await redirectTarget(response);
    assert(target?.includes("/admin/login"), `${route} does not redirect an unauthenticated user to login.`);
  }

  const roleResults = [];
  for (const account of accounts) {
    const login = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password }),
      redirect: "manual",
    });
    const payload = await login.json().catch(() => null);
    assert(login.status === 200, `Login for ${account.role} returned ${login.status}.`);
    assert(payload?.redirectTo === expectedDashboard[account.role], `Incorrect login redirect for ${account.role}: ${payload?.redirectTo}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert(cookie, `Session cookie is missing for ${account.role}.`);

    for (const route of adminRoutes) {
      const response = await request(route, { headers: { cookie }, redirect: "manual" });
      const target = await redirectTarget(response);
      const shouldAllow = allowed[account.role].has(route) || (route === "/admin/dashboard" && expectedDashboard[account.role] === route);
      if (shouldAllow) {
        assert(response.status === 200 && !target, `${account.role} cannot open ${route}: ${response.status} ${target || ""}`);
      } else {
        assert(Boolean(target), `${account.role} unexpectedly accessed ${route}: ${response.status}`);
      }
    }
    roleResults.push({ role: account.role, redirectTo: payload.redirectTo, allowedRoutes: [...allowed[account.role]] });
  }

  const locationsResponse = await request("/api/locations");
  assert(locationsResponse.status === 200, `/api/locations returned ${locationsResponse.status}.`);
  const locationsPayload = await locationsResponse.json();
  const locations = Array.isArray(locationsPayload) ? locationsPayload : locationsPayload.locations;
  assert(Array.isArray(locations) && locations.length > 0, "The public catalog contains no synthetic locations.");
  const detailId = locations[0].id || locations[0].code;
  for (const route of ["/locatii", `/locatii/${encodeURIComponent(detailId)}`]) {
    const response = await request(route);
    assert(response.status === 200, `${route} returned ${response.status}.`);
  }

  console.log(JSON.stringify({ ok: true, baseUrl, roles: roleResults, publicLocations: locations.length, checkedAdminRoutes: adminRoutes }, null, 2));
}

function request(route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (vercelShareCookie) {
    const existingCookie = headers.get("cookie");
    headers.set("cookie", existingCookie ? `${existingCookie}; ${vercelShareCookie}` : vercelShareCookie);
  }
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers.set("x-vercel-protection-bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }
  return fetch(`${baseUrl}${route}`, { ...options, headers });
}

async function ensureVercelShareCookie() {
  if (!vercelShareToken || vercelShareCookie) return;
  const response = await fetch(`${baseUrl}/?_vercel_share=${encodeURIComponent(vercelShareToken)}`, { redirect: "manual" });
  vercelShareCookie = response.headers.get("set-cookie")?.split(";")[0] || null;
  if (!vercelShareCookie) throw new Error("Vercel share token did not produce a bypass cookie.");
}

async function redirectTarget(response) {
  if ([302, 303, 307, 308].includes(response.status)) return String(response.headers.get("location") || "");
  if (response.status !== 200 || !String(response.headers.get("content-type") || "").includes("text/html")) return null;
  const body = await response.clone().text();
  const nextRedirect = body.match(/NEXT_REDIRECT;[^;]*;([^;]+);/);
  if (nextRedirect?.[1]) return nextRedirect[1];
  const metaRedirect = body.match(/content="\d+;url=([^" ]+)"/i);
  return metaRedirect?.[1] || null;
}

function assert(value, message) {
  if (!value) throw new Error(message);
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

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
