const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createBrowserRuntime } = require("./browser-runtime.cjs");

const dbUrl = new URL(process.env.DATABASE_URL || "invalid:");
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !dbUrl.pathname.startsWith("/focus_preview_") || [process.env.APP_ENV, process.env.VERCEL_ENV, process.env.NODE_ENV].includes("production") || process.env.ALLOW_SYNTHETIC_SEED !== "true" || process.env.PREVIEW_DATASET_ID !== "focus-media-synthetic-v1") throw new Error("Commercial browser verification requires an isolated local synthetic database.");
const base = (process.env.OOH_SMOKE_BASE_URL || "http://127.0.0.1:3040").replace(/\/$/, "");
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Local synthetic app required.");
const prisma = new PrismaClient({ log: [] });
const tag = "ooh-ui-" + crypto.randomUUID();
const password = crypto.randomBytes(24).toString("base64url");
const out = path.resolve(process.cwd(), process.env.OOH_SMOKE_OUT_DIR || "artifacts/ooh-commercial-flow");
let browser, policyCreated = false;
const ids = { seller: tag + "-seller", manager: tag + "-manager", category: tag + "-category", location: tag + "-location", client: tag + "-client", campaign: tag + "-campaign" };
function hash(value) { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString("base64url")}$${crypto.scryptSync(value, salt, 64).toString("base64url")}`; }
async function login(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const response = await context.request.post(base + "/api/auth/login", { headers: { origin: base }, data: { email: ids[role] + "@example.invalid", password } });
  assert.equal(response.status(), 200, `Synthetic ${role} login failed.`);
  return context;
}
(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    await prisma.user.createMany({ data: [
      { id: ids.seller, email: ids.seller + "@example.invalid", name: "Synthetic offer seller", role: "SALES_AGENT", active: true, passwordHash: hash(password) },
      { id: ids.manager, email: ids.manager + "@example.invalid", name: "Synthetic offer manager", role: "COO", active: true, passwordHash: hash(password) },
    ] });
    await prisma.category.create({ data: { id: ids.category, name: tag, slug: tag } });
    await prisma.location.create({ data: { id: ids.location, categoryId: ids.category, code: tag, city: "Synthetic City", type: "Billboard", rateCardValue: 100, lifecycleStatus: "ACTIVE", showInPublic: false, mainPhotoUrl: "/samples/location-placeholder.svg" } });
    await prisma.clientAccount.create({ data: { id: ids.client, companyName: tag, normalizedName: tag, accountOwnerUserId: ids.seller, generalEmail: "synthetic-offer@example.invalid", createdByUserId: ids.manager } });
    await prisma.campaign.create({ data: { id: ids.campaign, clientId: ids.client, campaignName: tag + " campaign", sellerUserId: ids.seller, accountOwnerUserId: ids.seller, createdByUserId: ids.manager, companyEntity: "Focus Media", currency: null, status: "draft" } });
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || createBrowserRuntime(9288).findChrome(), headless: true, args: ["--no-sandbox"] });
    const manager = await login("manager");
    let policy = await prisma.commercialPolicy.findUnique({ where: { id: "default" } });
    if (!policy) {
      const settings = await manager.newPage();
      await settings.goto(base + "/admin/commercial-settings", { timeout: 120000 });
      await settings.getByLabel("Cota TVA verificată (%)", { exact: true }).fill("21");
      await settings.getByLabel("Tratament TVA", { exact: true }).selectOption("exclusive");
      await settings.getByLabel("Moneda tarifelor de listă", { exact: true }).selectOption("EUR");
      await settings.getByRole("checkbox", { name: "Am verificat TVA, moneda tarifelor și condițiile comerciale.", exact: true }).check();
      await settings.getByRole("button", { name: "Salvează regulile comerciale", exact: true }).click();
      await settings.getByText("Operația a fost înregistrată și verificată.", { exact: true }).waitFor();
      policyCreated = true;
      policy = await prisma.commercialPolicy.findUniqueOrThrow({ where: { id: "default" } });
      await settings.close();
    }
    const seller = await login("seller");
    const page = await seller.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/admin/campanii?campaignId=" + ids.campaign, { timeout: 120000 });
    await page.getByRole("button", { name: "Editeaza", exact: true }).click();
    await page.getByLabel("Moneda propunerii comerciale", { exact: true }).selectOption(policy.rateCardCurrency);
    await page.getByRole("button", { name: "Salveaza", exact: true }).click();
    await page.getByText("Campania a fost actualizata.", { exact: true }).waitFor();
    assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: ids.campaign } })).currency, policy.rateCardCurrency);
    await page.goto(base + "/admin/selectie-locatii", { timeout: 120000 });
    await page.getByLabel("Client oferta", { exact: true }).fill(tag);
    await page.getByLabel("Campanie", { exact: true }).fill(tag + " campaign");
    await page.getByLabel("Start campanie", { exact: true }).fill("2091-01-01");
    await page.getByLabel("Final campanie", { exact: true }).fill("2091-01-31");
    await page.getByRole("row").filter({ hasText: tag }).getByRole("button", { name: "Adauga", exact: true }).click();
    const transfer = page.getByRole("button", { name: "Creează oferta cu aceste locații", exact: true });
    await transfer.waitFor();
    await assertEventually(async () => !(await transfer.isDisabled()), "Selection cannot continue to a real quote.");
    await transfer.click();
    await page.waitForURL("**/admin/commercial-quotes?selection=*", { timeout: 120000 });
    await page.getByLabel("Tarif lunar propus " + tag, { exact: true }).fill("80.00");
    await page.getByLabel("Justificare negociere " + tag, { exact: true }).fill("Synthetic negotiated package, approval required");
    assert.equal(await page.getByLabel("Prima zi inclusă", { exact: true }).inputValue(), "2091-01-01");
    assert.equal(await page.getByLabel("Ultima zi inclusă", { exact: true }).inputValue(), "2091-01-31");
    assert.equal(await page.getByLabel("Client", { exact: true }).inputValue(), ids.client);
    assert.equal(await page.getByLabel("Campanie și monedă", { exact: true }).inputValue(), ids.campaign);
    const saved = page.waitForResponse((response) => response.url().includes("/api/admin/commercial-workbench") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "quote.create");
    await page.getByRole("button", { name: "Salvează ciorna ofertei", exact: true }).click();
    const savedResponse = await saved; assert.equal(savedResponse.status(), 200);
    const quoteId = (await savedResponse.json()).result.quote.id;
    await page.getByRole("button", { name: "Pregătește o versiune nouă", exact: true }).waitFor();
    const quote = await prisma.commercialQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { revisions: true } });
    assert.equal(quote.revisions.length, 1);
    const payload = quote.revisions[0].payload;
    assert.equal(payload.lines[0].monthlyRate, "80.00");
    assert.equal(payload.lines[0].listMonthlyRate, "100.00");
    assert.equal(payload.pricingApprovalRequired, true);
    assert.equal(await prisma.reservation.count({ where: { locationId: ids.location } }), 0);
    assert.equal((await prisma.location.findUniqueOrThrow({ where: { id: ids.location } })).rateCardValue, 100);
    await page.getByRole("button", { name: "Pregătește o versiune nouă", exact: true }).click();
    await page.getByLabel("Tarif lunar propus " + tag, { exact: true }).fill("70,50");
    await page.getByLabel("Justificare negociere " + tag, { exact: true }).fill("Synthetic revised package after map review");
    await page.getByLabel("E-mail destinatar", { exact: true }).fill("reviewed-recipient@example.invalid");
    await page.getByLabel("Condiții și observații pentru revizuire", { exact: true }).fill("Keep these explicit negotiated terms through the map round trip.");
    await page.getByRole("button", { name: "Deschide selecția pe hartă", exact: true }).click();
    await page.waitForURL("**/admin/selectie-locatii?selection=*", { timeout: 120000 });
    const returnToQuote = page.getByRole("button", { name: "Creează oferta cu aceste locații", exact: true });
    await assertEventually(async () => !(await returnToQuote.isDisabled()), "Revision selection cannot return to its quote.");
    await returnToQuote.click();
    await page.waitForURL("**/admin/commercial-quotes?selection=*&quoteId=*&edit=1", { timeout: 120000 });
    await page.getByLabel("Tarif lunar propus " + tag, { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Tarif lunar propus " + tag, { exact: true }).inputValue(), "70.50");
    assert.equal(await page.getByLabel("E-mail destinatar", { exact: true }).inputValue(), "reviewed-recipient@example.invalid");
    assert.equal(await page.getByLabel("Condiții și observații pentru revizuire", { exact: true }).inputValue(), "Keep these explicit negotiated terms through the map round trip.");
    const revisedResponse = page.waitForResponse((response) => response.url().includes("/api/admin/commercial-workbench") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "quote.create");
    await page.getByRole("button", { name: "Salvează versiunea nouă", exact: true }).click();
    assert.equal((await revisedResponse).status(), 200);
    await page.getByRole("button", { name: "Pregătește o versiune nouă", exact: true }).waitFor();
    assert.equal(await prisma.commercialQuote.count({ where: { clientId: ids.client } }), 1, "Map round trip must revise the existing quote, not create a duplicate.");
    const revised = await prisma.quoteRevision.findUniqueOrThrow({ where: { quoteId_revision: { quoteId, revision: 2 } } });
    assert.equal(revised.payload.lines[0].monthlyRate, "70.50");
    assert.equal(revised.payload.recipient, "reviewed-recipient@example.invalid");
    await page.screenshot({ path: path.join(out, "negotiated-offer-desktop.png"), fullPage: true });
    await page.getByLabel("Caută în toate ofertele", { exact: true }).fill(tag);
    await page.getByRole("button", { name: "Caută", exact: true }).click();
    await page.getByRole("navigation", { name: "Paginare oferte", exact: true }).getByText(/1 oferte/).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, "negotiated-offer-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "Mobile layout overflows the viewport.");
    const unauthorized = await seller.request.get(base + "/admin/commercial-settings", { maxRedirects: 0 });
    assert.equal([303, 307, 308].includes(unauthorized.status()), true, "Seller must not manage shared commercial policy.");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checks: ["real seller login", "campaign currency before booking", "configured commercial policy outside AI", "selector to quote without reentry", "revision map round trip retains identity/prices/recipient", "negotiated price provenance", "no inventory allocation from draft", "catalog tariff preserved", "searchable history", "390px layout", "policy role isolation"], screenshots: out }));
  } finally {
    if (browser) await browser.close();
    const quotes = await prisma.commercialQuote.findMany({ where: { clientId: ids.client }, select: { id: true } });
    const quoteIds = quotes.map((row) => row.id);
    const revisions = await prisma.quoteRevision.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
    const revisionIds = revisions.map((row) => row.id);
    await prisma.commercialDispatch.deleteMany({ where: { revisionId: { in: revisionIds } } });
    await prisma.commercialAcceptance.deleteMany({ where: { revisionId: { in: revisionIds } } });
    await prisma.commercialApproval.deleteMany({ where: { revisionId: { in: revisionIds } } });
    await prisma.quoteRevision.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.commercialQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.campaign.deleteMany({ where: { id: ids.campaign } });
    await prisma.clientAccount.deleteMany({ where: { id: ids.client } });
    await prisma.location.deleteMany({ where: { id: ids.location } });
    await prisma.category.deleteMany({ where: { id: ids.category } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ids.seller, ids.manager] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.seller, ids.manager] } } });
    if (policyCreated) await prisma.commercialPolicy.deleteMany({ where: { id: "default" } });
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

async function assertEventually(predicate, message) {
  const until = Date.now() + 30000;
  while (Date.now() < until) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(message);
}
