import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";
import { commercialHash } from "../src/lib/commercial-workbench-core";
import { assertSyntheticEnvironment } from "./release/env-utils";
const { createBrowserRuntime } = require("./release/browser-runtime.cjs");

assertSyntheticEnvironment();
const connection = new URL(process.env.DATABASE_URL!);
const base = (process.env.OOH_SMOKE_BASE_URL || "http://localhost:3040").replace(/\/$/, "");
if (!["localhost", "127.0.0.1"].includes(connection.hostname) || !/^\/focus_(preview|test)_/.test(connection.pathname) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.VERCEL_ENV === "production") throw Error("Local synthetic database and app required");
const db = new PrismaClient();
const tag = `quote-print-browser-${randomUUID()}`;
const password = randomUUID() + randomUUID();
const ids = { users: [] as string[], client: "", campaign: "", quote: "" };
const output = resolve(process.env.OOH_PRINT_OUT_DIR || "artifacts/ooh-offer-print");

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || createBrowserRuntime(9289).findChrome(), headless: true, args: ["--no-sandbox"] });
  try {
    mkdirSync(output, { recursive: true });
    const passwordHash = await hashPassword(password);
    const seller = await db.user.create({ data: { name: "Synthetic print seller", email: `${tag}@example.invalid`, role: "SALES_AGENT", passwordHash } }); ids.users.push(seller.id);
    const other = await db.user.create({ data: { name: "Synthetic other seller", email: `${tag}-other@example.invalid`, role: "SALES_AGENT", passwordHash } }); ids.users.push(other.id);
    const client = await db.clientAccount.create({ data: { companyName: tag, accountOwnerUserId: seller.id } }); ids.client = client.id;
    const campaign = await db.campaign.create({ data: { campaignName: tag, clientId: client.id, sellerUserId: seller.id, currency: "EUR", companyEntity: "Focus Media" } }); ids.campaign = campaign.id;
    const quote = await db.commercialQuote.create({ data: { ownerUserId: seller.id, clientId: client.id, campaignId: campaign.id } }); ids.quote = quote.id;
    const payload = { schemaVersion: 2, clientId: client.id, campaignId: campaign.id, clientName: "Synthetic OOH Client", campaignName: "Synthetic city campaign", companyEntity: "Focus Media", recipient: "print@example.invalid", periodStart: "2091-01-01", periodEnd: "2091-01-31", currency: "EUR", policyVersion: 1, paymentTermDays: null, vatRateBps: 2100, vatTreatment: "exclusive", assumptions: "Text de contract <script>window.printInjected=true</script>", lines: [{ locationId: tag, code: "SYN-PRINT-01", city: "București", monthlyRate: "80.00", net: "80.00", tax: "16.80", gross: "96.80" }], totals: { net: "80.00", tax: "16.80", gross: "96.80" } };
    const revision = await db.quoteRevision.create({ data: { quoteId: quote.id, revision: 1, createdByUserId: seller.id, payload, payloadHash: commercialHash(payload), requestKey: tag, intentHash: commercialHash(tag), totalNet: 80, totalTax: 16.8, totalGross: 96.8, currency: "EUR", expiresAt: new Date(Date.now() + 86400000), availabilityHash: commercialHash("synthetic") } });
    const route = `${base}/admin/commercial-quotes/${quote.id}/print?revision=${revision.id}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(base + "/api/auth/login", { headers: { origin: base }, data: { email: seller.email, password } });
    assert.equal(login.status(), 200, "real seller session required");
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route, { timeout: 120000 });
    assert.equal(response?.status(), 200);
    assert.match(response?.headers()["cache-control"] || "", /no-store/);
    await page.getByRole("heading", { name: "Ofertă publicitate OOH", exact: true }).waitFor();
    assert.ok((await page.locator(".quote-print-paper").innerText()).includes("96,80 EUR"));
    assert.equal(await page.locator(".quote-print-watermark").innerText(), "CIORNĂ");
    assert.equal(await page.evaluate(() => (window as unknown as Record<string, unknown>).printInjected), undefined, "untrusted notes never execute as HTML");
    await page.screenshot({ path: resolve(output, "offer-desktop.png"), fullPage: true });
    const pdf = await page.pdf({ path: resolve(output, "offer.pdf"), format: "A4", printBackground: true });
    assert.ok(pdf.byteLength > 5000, "browser produces a usable PDF from the private immutable view");
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".quote-print-actions").evaluate((node) => getComputedStyle(node).display), "none", "working controls are excluded from the exported document");
    await page.emulateMedia({ media: "screen" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, "offer-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "wide pricing table scrolls inside the document rather than overflowing the phone page");
    const before = revision.payloadHash;
    assert.equal((await db.quoteRevision.findUniqueOrThrow({ where: { id: revision.id } })).payloadHash, before, "printing does not modify the quote");
    const outsider = await browser.newContext();
    assert.equal((await outsider.request.post(base + "/api/auth/login", { headers: { origin: base }, data: { email: other.email, password } })).status(), 200);
    const deniedPage = await outsider.newPage();
    const denied = await deniedPage.goto(route, { timeout: 120000 });
    await deniedPage.getByRole("heading", { name: "404", exact: true }).waitFor();
    assert.equal((await denied!.text()).includes("SYN-PRINT-01"), false, "a streamed not-found response must contain no private offer");
    assert.equal(await deniedPage.locator(".quote-print-paper").count(), 0);
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    const anonymousResult = await anonymousPage.goto(route, { timeout: 120000 });
    await anonymousPage.waitForURL((url) => url.pathname === "/admin/login", { timeout: 30000 });
    assert.equal((await anonymousResult!.text()).includes("SYN-PRINT-01"), false);
    assert.deepEqual(errors, []);
    writeFileSync(resolve(output, "result.json"), JSON.stringify({ ok: true, groups: 8, desktop: "1440x1000", mobile: "390x844", pdfBytes: pdf.byteLength, cache: "private/no-store", privateData: "synthetic-only", states: ["draft watermark", "own seller", "foreign seller not-found view without private content", "anonymous login redirect"] }, null, 2));
    console.log(JSON.stringify({ ok: true, groups: 8, pdfBytes: pdf.byteLength, output }));
  } finally {
    await browser.close();
    if (ids.quote) { await db.quoteRevision.deleteMany({ where: { quoteId: ids.quote } }); await db.commercialQuote.deleteMany({ where: { id: ids.quote } }); }
    if (ids.campaign) await db.campaign.deleteMany({ where: { id: ids.campaign } });
    if (ids.client) await db.clientAccount.deleteMany({ where: { id: ids.client } });
    await db.user.deleteMany({ where: { id: { in: ids.users } } }); await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
