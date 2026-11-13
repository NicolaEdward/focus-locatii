import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { hashPassword, type AuthSession } from "../src/lib/auth";
import { registerAssistantClient } from "../src/lib/assistant-oauth";
import { assertSyntheticEnvironment, loadEnvFile } from "./release/env-utils";
const require = createRequire(import.meta.url);
const { createBrowserRuntime } = require("./release/browser-runtime.cjs");
const { renderedUiAudit } = require("./release/ui-accessibility-audit.cjs");
loadEnvFile();
assertSyntheticEnvironment();
const base = process.env.ASSISTANT_MCP_BASE_URL!;
assert.equal(new URL(base).hostname, "127.0.0.1");
const tag = `mcp-ui-${randomUUID()}`,
  output = path.resolve("artifacts/assistant-mcp-ui"),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "focus-mcp-ui-"));
const callbackServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<main>Synthetic OAuth callback</main>");
});
const runtime = createBrowserRuntime(9251);
let browser: ReturnType<typeof spawn> | undefined;
let c: any;
let actor: AuthSession | undefined;
async function evaluate(expression: string) {
  const r = await c.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function main() {
  const entry = await fetch(base + "/admin/login", { redirect: "manual" });
  assert.equal(entry.status, 200, "Production browser endpoint must be ready");
  const csp = entry.headers.get("content-security-policy") || "";
  assert.ok(csp.includes("script-src 'self'") && csp.includes("form-action 'self'"), "Production CSP must protect scripts and form destinations");
  assert.equal(csp.includes("'unsafe-eval'"), false, "The OAuth browser flow must pass without a development CSP exception");
  fs.mkdirSync(output, { recursive: true });
  await new Promise<void>((resolve) =>
    callbackServer.listen(0, "127.0.0.1", resolve),
  );
  const callback = `http://127.0.0.1:${(callbackServer.address() as AddressInfo).port}/synthetic-callback`;
  const password = "Synthetic-Mcp-Ui-Only-2026!";
  const user = await prisma.user.create({
    data: {
      id: tag,
      name: "Synthetic MCP UI",
      email: `${tag}@example.invalid`,
      role: "SUPER_ADMIN",
      passwordHash: await hashPassword(password),
    },
  });
  actor = {
    ...user,
    role: "SUPER_ADMIN",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const client = await registerAssistantClient(
    {
      name: "Synthetic ChatGPT UI",
      redirectUris: [callback],
      scopes: ["inventory.read"],
      confidential: true,
    },
    actor,
  );
  const query = new URLSearchParams({
    client_id: client.id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge: createHash("sha256")
      .update(randomBytes(32).toString("base64url"))
      .digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(24).toString("base64url"),
    scope: "inventory.read offline_access",
    resource: base + "/api/mcp",
  });
  browser = spawn(
    runtime.findChrome(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=9251",
      `--user-data-dir=${temp}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await runtime.waitForChrome();
  const target = await runtime.createTarget("about:blank");
  c = runtime.connect(target.webSocketDebuggerUrl);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Network.enable");
  await c.send("Page.navigate", { url: base + "/oauth/authorize?" + query });
  await runtime.waitForExpression(
    c,
    "!!document.querySelector('input[type=email]')",
    90000,
  );
  await runtime.waitForExpression(
    c,
    "Object.keys(document.querySelector('form')||{}).some(k=>k.startsWith('__reactProps')&&typeof document.querySelector('form')[k]?.onSubmit==='function')",
    30000,
  );
  for (const [selector, value] of [
    ["input[type=email]", user.email],
    ["input[type=password]", password],
  ]) {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await c.send("Input.insertText", { text: value });
  }
  await evaluate("document.querySelector('form').requestSubmit()");
  await runtime.waitForExpression(
    c,
    "document.body.innerText.includes('Permiți verificări din ChatGPT?')",
    90000,
  );
  assert.ok(
    await evaluate("location.pathname==='/oauth/authorize'"),
    "Login returns to local OAuth consent",
  );
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const picture = await c.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.writeFileSync(
    path.join(output, "consent-390.png"),
    Buffer.from(picture.data, "base64"),
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth+1"),
    false,
    "Consent has no horizontal page overflow",
  );
  await evaluate("document.querySelector('button[value=allow]').click()");
  await runtime.waitForExpression(
    c,
    "location.pathname==='/synthetic-callback'",
    90000,
  );
  assert.ok(
    await evaluate("new URLSearchParams(location.search).has('code')"),
    "Browser consent returns OAuth code",
  );
  const evidence = [];
  for (const width of [390, 768, 1440])
    for (const theme of ["light", "dark"]) {
      await c.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 900,
        deviceScaleFactor: 1,
        mobile: width === 390,
      });
      await c.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `localStorage.setItem('focus-admin-theme',${JSON.stringify(theme)})`,
      });
      await c.send("Page.navigate", {
        url: base + "/admin/assistant-connections",
      });
      await runtime.waitForExpression(
        c,
        "document.readyState==='complete'&&document.body.innerText.includes('Delegările mele')",
        90000,
      );
      const audit = await evaluate(`(${renderedUiAudit.toString()})()`);
      assert.deepEqual(
        audit.critical,
        [],
        `${width}/${theme}: contrast/reflow audit`,
      );
      const overflow = await evaluate(
        "document.documentElement.scrollWidth>innerWidth+1",
      );
      assert.equal(overflow, false, `${width}/${theme}: horizontal overflow`);
      const shot = await c.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const file = `connections-${width}-${theme}.png`;
      fs.writeFileSync(
        path.join(output, file),
        Buffer.from(shot.data, "base64"),
      );
      evidence.push({ width, theme, overflow, file, audit });
    }
  await evaluate(
    "[...document.querySelectorAll('button')].find(b=>b.textContent==='Revocă accesul').click()",
  );
  await runtime.waitForExpression(
    c,
    "document.body.innerText.includes('Revocată')",
    30000,
  );
  assert.equal(
    await prisma.assistantOAuthGrant.count({
      where: { userId: user.id, revokedAt: null },
    }),
    0,
    "UI revoke persists",
  );
  const runtimeErrors = c.events.filter(
    (e: any) => e.method === "Runtime.exceptionThrown",
  );
  assert.equal(runtimeErrors.length, 0, "No browser runtime exceptions");
  fs.writeFileSync(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        passed: true,
        flow: "browser login→local OAuth consent→code→connections→revoke",
        runtimeErrors: 0,
        productionCspVerified: true,
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, screenshots: 7, runtimeErrors: 0, productionCspVerified: true, output }),
  );
}
main()
  .finally(async () => {
    c?.close();
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { browser?.kill("SIGKILL"); resolve(); }, 5000);
        browser!.once("exit", () => { clearTimeout(timer); resolve(); });
        browser!.kill();
      });
    }
    callbackServer.closeAllConnections();
    await new Promise<void>((resolve) => callbackServer.close(() => resolve()));
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
    catch { console.warn("Temporary Chrome profile cleanup deferred; database fixture cleanup continues."); }
    if (actor) {
      const grants = await prisma.assistantOAuthGrant.findMany({
        where: { userId: actor.id },
        select: { id: true },
      });
      const ids = grants.map((g) => g.id);
      await prisma.assistantOAuthToken.deleteMany({
        where: { grantId: { in: ids } },
      });
      await prisma.assistantOAuthCode.deleteMany({
        where: { grantId: { in: ids } },
      });
      await prisma.assistantOAuthGrant.deleteMany({
        where: { id: { in: ids } },
      });
      await prisma.assistantOAuthConsent.deleteMany({
        where: { userId: actor.id },
      });
      await prisma.assistantOAuthClient.deleteMany({
        where: { createdByUserId: actor.id },
      });
      await prisma.auditLog.deleteMany({ where: { userId: actor.id } });
      await prisma.authSessionRecord.deleteMany({
        where: { userId: actor.id },
      });
      await prisma.user.delete({ where: { id: actor.id } });
    }
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
