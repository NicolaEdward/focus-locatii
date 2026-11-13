const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const accounts = require("./preview-accounts.json");
const { createBrowserRuntime } = require("./browser-runtime.cjs");

const database = new URL(process.env.DATABASE_URL || "invalid:");
const base = new URL(process.env.OOH_WORKSPACE_BROWSER_BASE_URL || "http://localhost:3040");
if (!["localhost", "127.0.0.1"].includes(database.hostname) || !/^\/focus_(preview|test)_/.test(database.pathname)
  || !["localhost", "127.0.0.1"].includes(base.hostname) || process.env.VERCEL_ENV === "production"
  || !["ci", "test", "preview"].includes(process.env.APP_ENV) || process.env.ALLOW_SYNTHETIC_SEED !== "true") {
  throw new Error("Workspace browser states require the isolated local synthetic app.");
}
if (!process.env.PREVIEW_TEST_PASSWORD) throw new Error("The synthetic role login is not configured.");
const output = path.resolve("artifacts/ooh-workspace-states");
let browser;
let checkpoint = "browser startup";

(async () => {
  try {
    fs.mkdirSync(output, { recursive: true });
    browser = await chromium.launch({ executablePath: createBrowserRuntime(9286).findChrome(), headless: true, args: ["--no-sandbox", "--disable-gpu"] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const seller = accounts.find((account) => account.role === "SALES_AGENT");
    checkpoint = "real seller login";
    const login = await context.request.post(new URL("/api/auth/login", base).href, {
      headers: { origin: base.origin }, data: { email: seller.email, password: process.env.PREVIEW_TEST_PASSWORD },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.name));

    checkpoint = "real contractual source status";
    const reportResponse = await context.request.get(new URL("/api/admin/contract-control", base).href);
    assert.equal(reportResponse.status(), 200);
    const report = await reportResponse.json();
    assert.equal(report.portfolioScope, "own");
    assert(reportResponse.headers()["cache-control"].includes("no-store"));
    await page.goto(new URL("/admin/control-contractual", base).href);
    const sourceHeading = report.source.state === "unconfigured" ? "Arhiva contractuală nu este conectată"
      : report.source.state === "sync_required" ? "Arhiva trebuie sincronizată complet" : "Referințe contractuale indexate";
    await page.getByRole("heading", { name: sourceHeading, exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Conectează și verifică arhiva", exact: true }).count(), 0, "A seller cannot manage NAS credentials or source configuration.");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
    await page.screenshot({ path: path.join(output, "contract-source-mobile.png"), fullPage: false });

    checkpoint = "empty search remains unverified";
    await page.getByLabel("Caută locație, client, campanie sau contract", { exact: true }).fill("nonexistent-synthetic-contract-" + Date.now());
    await page.getByRole("button", { name: "Aplică", exact: true }).click();
    await page.getByText("Nu există închirieri BOOKED care să corespundă filtrelor. Aceasta nu este o confirmare a concordanței tuturor contractelor.", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "contract-empty-mobile.png"), fullPage: false });

    checkpoint = "initial report failure is not a zero";
    await page.route("**/api/admin/contract-control?*", (route) => route.fulfill({
      status: 503, contentType: "application/json", headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({ error: "Raport indisponibil pentru verificarea sintetică." }),
    }));
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Lipsa raportului nu înseamnă că nu există probleme." }).waitFor();
    assert.equal(await page.getByRole("region", { name: "Situație contractuală", exact: true }).count(), 0, "An unavailable source cannot render verified KPI zeroes.");
    await page.screenshot({ path: path.join(output, "contract-error-mobile.png"), fullPage: false });

    checkpoint = "reload recovers the canonical report";
    await page.unroute("**/api/admin/contract-control?*");
    await page.getByRole("button", { name: "Actualizează", exact: true }).click();
    await page.getByRole("heading", { name: sourceHeading, exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.deepEqual(runtimeErrors, []);
    console.log(JSON.stringify({ ok: true, checks: 5, screenshots: 3, portfolio: "own", sourceState: report.source.state,
      covered: ["authentic role login", "read-only source status", "empty search honesty", "network failure without zero KPIs", "recovery and mobile layout"],
      externalMessages: 0, productionWrites: 0 }));
  } finally { await browser?.close(); }
})().catch(() => { console.error("Workspace states browser verification failed at: " + checkpoint); process.exitCode = 1; });
