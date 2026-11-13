// Controlled API fixtures against a local synthetic application. No location,
// reservation, campaign or financial mutation is submitted.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { renderedUiAudit } = require("./ui-accessibility-audit.cjs");
const database = new URL(process.env.DATABASE_URL || "invalid:");
if (!['ci', 'test', 'preview'].includes(process.env.APP_ENV) || process.env.VERCEL_ENV === 'production' || process.env.ALLOW_SYNTHETIC_SEED !== 'true' || !['127.0.0.1', 'localhost'].includes(database.hostname) || !database.pathname.startsWith('/focus_preview_')) throw Error("Local isolated synthetic database required");
const base = process.env.OCCUPANCY_UI_BASE_URL || "http://localhost:3128";
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error("Local application required");
const output = path.resolve(process.env.OCCUPANCY_UI_OUT_DIR || "artifacts/occupancy-ui");
const prisma = new PrismaClient({ log: [] });
const id = "occupancy-browser-" + crypto.randomUUID();
const password = crypto.randomBytes(32).toString("base64url");
const salt = crypto.randomBytes(16);
const passwordHash = `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(password, salt, 64).toString('base64url')}`;
const inventory = { asOf: "2026-11-13T23:30:00.000Z", dateKey: "2026-11-14", timeZone: "Europe/Bucharest", activeLocations: 6, staticLocations: 5, digitalLocations: 1, maintenanceLocations: 2, freeToday: 3, occupiedToday: 2, heldToday: 0, blockedToday: 0, unknownToday: 0 };
const empty = Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, typeof value === "number" ? 0 : value]));
function summary(mode) {
  return { occupiedNow: 1, activeHolds: 1, upcoming: 12, activeOrUpcoming: 14, inventory: mode === "unknown" || mode === "loading" ? null : mode === "zero" ? empty : mode === "invalid" ? { ...inventory, freeToday: 100 } : inventory };
}
async function main() {
  let browser;
  const captures = [], pageErrors = [];
  try {
    fs.mkdirSync(output, { recursive: true });
    await prisma.user.create({ data: { id, email: id + "@example.invalid", name: "Synthetic Occupancy Browser", role: "COO", passwordHash } });
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    for (const width of [390, 768]) for (const theme of ["light", "dark"]) {
      let mode = "known", release = null;
      const context = await browser.newContext({ viewport: { width, height: 1024 } });
      await context.addInitScript((value) => localStorage.setItem("focus-admin-theme", value), theme);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/api/reservations" && ["workspace", "occupancy-summary"].includes(url.searchParams.get("view"))) {
          if (url.searchParams.get("view") === "workspace") {
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            return route.fulfill({ response, json: { ...await response.json(), summary: summary(mode) } });
          }
          if (mode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic unavailable read" }) });
          if (mode === "loading") await new Promise((resolve) => { release = resolve; });
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: summary(mode) }) });
        }
        return route.continue();
      });
      const login = await context.request.post(base + "/api/auth/login", { headers: { origin: base }, data: { email: id + "@example.invalid", password } });
      assert.equal(login.status(), 200);
      const page = await context.newPage();
      page.on("pageerror", (error) => pageErrors.push(error.name));
      const response = await page.goto(base + "/admin/locatii?newReservation=1", { timeout: 120000 });
      assert.ok(response.headers()["content-security-policy"], "Production CSP remains enabled");
      const dialog = page.getByRole("dialog", { name: "Gestionare rezervari", exact: true });
      await dialog.getByRole("article", { name: "Libere azi: 3", exact: true }).waitFor({ timeout: 90000 });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      async function capture(state) {
        const box = await dialog.boundingBox(); assert.ok(box && box.width <= width + 1);
        const layout = await dialog.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
        assert.ok(layout.scroll <= layout.client + 1, `${state}/${theme}/${width} must reflow without horizontal clipping`);
        const audit = await page.evaluate(renderedUiAudit);
        assert.deepEqual(audit.critical, [], `${state}/${theme}/${width} accessibility checks`);
        const file = `${width}-${theme}-${state}.png`;
        await page.screenshot({ path: path.join(output, file), fullPage: false });
        captures.push({ width, theme, state, file, contrastChecks: audit.contrastChecked, warnings: audit.warnings });
      }
      const refresh = dialog.getByRole("button", { name: "Actualizează disponibilitatea", exact: true });
      await capture("known");
      assert.equal(await dialog.getByRole("article", { name: "Ocupate azi: 2", exact: true }).count(), 1, "Global count is not the actor's one reservation row");
      mode = "zero"; await refresh.click();
      await dialog.getByRole("article", { name: "Libere azi: 0", exact: true }).waitFor(); await capture("zero");
      mode = "unknown"; await refresh.click();
      await dialog.getByRole("article", { name: "Libere azi: neverificat", exact: true }).waitFor(); await capture("unknown");
      mode = "loading"; await refresh.click();
      await dialog.getByText("Se verifică disponibilitatea locațiilor.", { exact: true }).waitFor();
      assert.equal(await refresh.isDisabled(), true);
      await capture("loading");
      assert.ok(release); release();
      await dialog.getByText(/Disponibilitatea locațiilor nu este verificată/).waitFor();
      mode = "known"; await refresh.click();
      await dialog.getByRole("article", { name: "Libere azi: 3", exact: true }).waitFor();
      mode = "error"; await refresh.click();
      await dialog.getByText(/Actualizarea disponibilității a eșuat/).waitFor();
      assert.equal(await dialog.getByRole("article", { name: "Libere azi: 3", exact: true }).count(), 1);
      await capture("stale-error");
      mode = "invalid"; await refresh.click();
      await dialog.getByRole("article", { name: "Libere azi: neverificat", exact: true }).waitFor(); await capture("malformed");
      await context.close();
    }
    assert.deepEqual(pageErrors, []);
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ passed: true, syntheticApiFixtures: true, locationOrFinancialMutations: 0, productionCspEnabled: true, captures, pageErrors }, null, 2) + "\n");
    console.log(JSON.stringify({ passed: true, captures: captures.length, widths: [390, 768], themes: ["light", "dark"], states: ["known", "zero", "unknown", "loading", "stale-error", "malformed"], pageErrors: 0, output }));
  } finally {
    if (browser) await browser.close();
    await prisma.auditLog.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
