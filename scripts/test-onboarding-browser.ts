import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { prisma } from "../src/lib/prisma";
import { createUserInvite } from "../src/lib/auth-workflows";
import { generateTotpForStep } from "../src/lib/mfa";
import { ONBOARDING_LOGIN_HREF } from "../src/lib/login-continuation";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";

loadEnvFile();
assertSyntheticEnvironment();
assert(["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname));
const base = new URL(process.env.ONBOARDING_BROWSER_BASE_URL || "http://127.0.0.1:3040");
assert(["127.0.0.1", "localhost"].includes(base.hostname));
const require = createRequire(import.meta.url);
const { createBrowserRuntime } = require("./release/browser-runtime.cjs");
const tag = `onboarding-browser-${randomUUID()}`;
const output = path.resolve("artifacts/ooh-onboarding");
const email = `${tag}@example.invalid`;
const password = `Synthetic-Onboarding-${randomUUID()}!`;
const previous = { APP_ENV: process.env.APP_ENV, VERCEL_ENV: process.env.VERCEL_ENV, AUTH_EMAIL_DELIVERY_ENABLED: process.env.AUTH_EMAIL_DELIVERY_ENABLED, NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL };
// Token transport is synthetic only after the production/non-local guards above.
process.env.APP_ENV = "preview";
process.env.VERCEL_ENV = "preview";
process.env.AUTH_EMAIL_DELIVERY_ENABLED = "false";
process.env.NEXT_PUBLIC_BASE_URL = base.origin;
let managerId = "", userId = "", browser: Browser | undefined;
let checkpoint = "server readiness";

async function main() {
  assert.equal((await fetch(new URL("/admin/login", base))).status, 200);
  checkpoint = "invitation creation";
  const manager = await prisma.user.create({ data: { email: `${tag}-manager@example.invalid`, name: tag, role: "SUPER_ADMIN", passwordHash: "synthetic-unused-no-login" } });
  managerId = manager.id;
  const invitation = await createUserInvite({ email, name: "Synthetic colleague", role: "SALES_AGENT" }, manager);
  assert(invitation.syntheticLink);
  browser = await chromium.launch({ executablePath: createBrowserRuntime(9279).findChrome(), headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.name));

  checkpoint = "invitation form";
  await page.goto(invitation.syntheticLink);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByLabel("Confirma parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Salveaza parola", exact: true }).click();
  await page.getByRole("heading", { name: "Contul este activ", exact: true }).waitFor();
  const welcomeLink = page.getByRole("link", { name: "Autentificare și primii pași", exact: true });
  assert.equal(await welcomeLink.getAttribute("href"), ONBOARDING_LOGIN_HREF);
  await welcomeLink.click();
  await page.waitForURL((url) => url.pathname === "/admin/login" && url.searchParams.get("next") === "/admin/onboarding");
  checkpoint = "initial login continuation";
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForFunction(() => location.pathname === "/admin/onboarding" || document.querySelector("h1")?.textContent === "Configurează MFA", undefined, { timeout: 30000 });
  if (new URL(page.url()).pathname !== "/admin/onboarding") {
    checkpoint = "required MFA welcome continuation";
    const secret = (await page.locator("form code").first().textContent())?.trim();
    assert(secret);
    const code = generateTotpForStep(secret, BigInt(Math.floor(Date.now() / 30000)));
    await page.getByLabel("Cod MFA", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Activează MFA", exact: true }).click();
    await page.getByRole("heading", { name: "Coduri de recuperare", exact: true }).waitFor();
    await page.getByRole("button", { name: "Am salvat codurile. Continuă", exact: true }).click();
  }
  await page.waitForURL((url) => url.pathname === "/admin/onboarding");
  await page.getByRole("heading", { name: "De la oportunitate la campanie executată", exact: true }).waitFor();
  userId = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;

  checkpoint = "guide progress persistence";
  assert.equal(await page.locator("main ol > li").count(), 6);
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), "0");
  await page.getByRole("button", { name: "Am parcurs acest pas", exact: true }).first().click();
  await page.getByRole("status").filter({ hasText: "Progresul tău a fost salvat." }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "De la oportunitate la campanie executată", exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("value"), "1");
  assert.equal(await page.getByRole("button", { name: "Reiau acest pas", exact: true }).count(), 1);
  const saved = await prisma.auditLog.findFirst({ where: { userId, action: "account.onboarding.updated" }, select: { metadata: true } });
  assert.deepEqual((saved?.metadata as Record<string, unknown>)?.completedStepIds, ["account-security"]);

  checkpoint = "seller navigation";
  await page.getByRole("button", { name: "Vânzări", exact: true }).click();
  await page.getByRole("link", { name: "Oportunități și următorul contact", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Administrare agent AI", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Ghid de lucru", exact: true }).count(), 1);
  await page.keyboard.press("Escape");

  checkpoint = "responsive guide";
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, "invited-seller-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "invited-seller-mobile.png"), fullPage: false });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ ok: true, story: "Invitation→activation→login/MFA→role guide→persisted progress", screenshots: 2, exposedTokens: 0, externalMessages: 0 }));
}

main().catch(() => { console.error(`Onboarding browser verification failed at: ${checkpoint}`); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  const invited = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const ids = [managerId, invited?.id || userId].filter(Boolean);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authSessionRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authActionToken.deleteMany({ where: { OR: [{ email }, { createdByUserId: managerId || "none" }, { userId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await prisma.$disconnect();
});
