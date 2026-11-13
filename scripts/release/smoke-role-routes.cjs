const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const accounts = require("./preview-accounts.json");

loadEnvFile(process.env.ENV_FILE);
const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3015").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD;
const vercelShareToken = process.env.VERCEL_SHARE_TOKEN;
let vercelShareCookie = null;
if (!password) throw new Error("PREVIEW_TEST_PASSWORD is missing.");
const prisma = new PrismaClient();

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
  SUPER_ADMIN: "/admin/dashboard",
  COO: "/admin/dashboard",
  D_CEO: "/admin/dashboard",
  SALES_DIRECTOR: "/admin/dashboard",
  SALES_AGENT: "/admin/dashboard",
  FINANCE_OPERATOR: "/admin/financiar/incasari",
  FIELD_OPERATOR: "/admin/operational",
};
const allowed = {
  SUPER_ADMIN: new Set(adminRoutes),
  COO: new Set(adminRoutes),
  D_CEO: new Set(adminRoutes.filter((route) => !["/admin/locatii/import", "/admin/locatii/gps", "/admin/integritate-date"].includes(route))),
  SALES_DIRECTOR: new Set(adminRoutes.filter((route) => !["/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/utilizatori", "/admin/integritate-date"].includes(route))),
  SALES_AGENT: new Set(adminRoutes.filter((route) => !["/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/locatii/import", "/admin/locatii/gps", "/admin/utilizatori", "/admin/integritate-date"].includes(route))),
  FINANCE_OPERATOR: new Set(["/admin/clienti", "/admin/campanii", "/admin/financiar/incasari", "/admin/integrari/saga", "/admin/furnizori", "/admin/securitate"]),
  FIELD_OPERATOR: new Set(["/admin/operational", "/admin/securitate"]),
};

// Every new entry point participates in the same authenticated role matrix.
// Hiding an administration link is not a substitute for a server-side guard.
const workspaceRoutes = [
  { route: "/admin/onboarding", roles: accounts.map((account) => account.role) },
  { route: "/admin/commercial-settings", roles: ["SUPER_ADMIN", "COO"] },
  { route: "/admin/control-contractual", roles: ["SUPER_ADMIN", "COO", "D_CEO", "SALES_DIRECTOR", "SALES_AGENT"] },
  { route: "/admin/ai", roles: ["SUPER_ADMIN", "COO", "SALES_DIRECTOR"] },
  { route: "/admin/document-audit", roles: ["SUPER_ADMIN", "COO", "D_CEO"] },
  { route: "/admin/assistant-connections", roles: accounts.filter((account) => account.role !== "FIELD_OPERATOR").map((account) => account.role) },
];
for (const entry of workspaceRoutes) {
  adminRoutes.push(entry.route);
  for (const role of entry.roles) allowed[role].add(entry.route);
}

async function main() {
  const businessCountsBefore = await businessCounts();
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
    const onboarding = await request("/api/admin/onboarding", { headers: { cookie } });
    const onboardingPayload = await onboarding.json().catch(() => null);
    assert(onboarding.status === 200 && onboardingPayload?.state?.role === account.role,
      `${account.role} cannot read its own role guide state.`);
    assert(onboarding.headers.get("cache-control")?.includes("no-store"), "Personal guide state must not be cached.");
    const contractual = await request("/api/admin/contract-control", { headers: { cookie } });
    const contractualAllowed = workspaceRoutes.find((entry) => entry.route === "/admin/control-contractual").roles.includes(account.role);
    assert(contractual.status === (contractualAllowed ? 200 : 403),
      `${account.role} contractual report permission does not match the page guard: ${contractual.status}.`);
    assert(contractual.headers.get("cache-control")?.includes("no-store"), "Contractual report must not be cached.");
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

  const businessCountsAfter = await businessCounts();
  assert(
    JSON.stringify(businessCountsAfter) === JSON.stringify(businessCountsBefore),
    "Role-based navigation changed sensitive business counts."
  );
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    roles: roleResults,
    publicLocations: locations.length,
    checkedAdminRoutes: adminRoutes,
    businessCountsBefore,
    businessCountsAfter
  }, null, 2));
}

async function businessCounts() {
  const [reservations, holds, booked, receivables, payments, notifications, proofs, operationTasks] = await Promise.all([
    prisma.reservation.count(),
    prisma.reservation.count({ where: { status: "HOLD" } }),
    prisma.reservation.count({ where: { status: "BOOKED" } }),
    prisma.financialReceivable.count(),
    prisma.financialReceivablePayment.count(),
    prisma.appNotification.count(),
    prisma.clientDocument.count({ where: { documentType: "operational_proof_photo" } }),
    prisma.operationTask.count()
  ]);
  return { reservations, holds, booked, receivables, payments, notifications, proofs, operationTasks };
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

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
