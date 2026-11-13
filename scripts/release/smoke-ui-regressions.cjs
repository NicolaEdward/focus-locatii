// Interactive browser tests on the isolated synthetic app. No business mutation
// is submitted: API states are intercepted in this browser, and modal fixtures
// mount the actual shared component on an ephemeral local HTTP server.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const { createBrowserRuntime } = require("./browser-runtime.cjs");
const { renderedUiAudit } = require("./ui-accessibility-audit.cjs");

loadEnv(process.env.ENV_FILE);
const base = String(process.env.UI_SMOKE_BASE_URL || process.env.BASE_URL || process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const url = new URL(base);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "UI fixtures must run on an isolated loopback app.");
assert.ok(["ci", "preview", "test"].includes(process.env.APP_ENV), "APP_ENV must identify a synthetic environment.");
assert.notEqual(process.env.VERCEL_ENV, "production", "Never run synthetic UI checks against Production.");
assert.equal(process.env.ALLOW_SYNTHETIC_SEED, "true");
const db = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname.includes("focus_preview"), "Synthetic local database required.");
const debugPort = Number(process.env.UI_SMOKE_CHROME_PORT || 9232);
const { findChrome, waitForChrome, createTarget, connect, waitForExpression, wait } = createBrowserRuntime(debugPort);
const output = path.resolve(process.env.UI_SMOKE_OUT_DIR || "artifacts/ui-regressions");
const evidence = [];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "focus-ui-browser-"));
let chrome;
let fixtureServer;

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function press(client, key, modifiers = 0) {
  const windowsVirtualKeyCode = { Tab: 9, Escape: 27, Enter: 13, ArrowDown: 40 }[key];
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode, modifiers, ...(key === "Enter" ? { text: "\r" } : {}) });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode, modifiers });
}

async function openPage(route, viewport, theme = "light", fixtureMode = null) {
  const target = await createTarget("about:blank");
  const client = connect(target.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  if (process.env.UI_TEST_BROWSER_BYPASS_CSP === "true") await client.send("Page.setBypassCSP", { enabled: true });
  await client.send("Emulation.setDeviceMetricsOverride", { width: viewport, height: viewport <= 390 ? 844 : viewport <= 768 ? 1024 : 900, deviceScaleFactor: 1, mobile: viewport < 700 });
  const [name, value] = sessionCookie.split("=");
  await client.send("Network.setCookie", { name, value, domain: url.hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" });
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("focus-admin-theme", ${JSON.stringify(theme)});` });
  if (fixtureMode) await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installCrmFixture.toString()})(${JSON.stringify(fixtureMode)});` });
  await client.send("Page.navigate", { url: base + route });
  // Next can stream hidden route segments before replacing its visible loading
  // boundary. DOM presence alone would audit an unpainted, hidden workspace.
  await waitForExpression(client, "document.readyState === 'complete' && !!document.querySelector('nav.admin-nav') && (innerWidth >= 1280 || !!document.querySelector('[data-admin-mobile-menu-trigger]')?.getClientRects().length)", 90000);
  return client;
}

function installCrmFixture(mode) {
  const original = window.fetch;
  window.__crmAuditMode = mode;
  const fixture = (requestUrl) => {
    const view = new URL(requestUrl, location.origin).searchParams.get("view") || "today";
    const many = window.__crmAuditMode === "many";
    const empty = window.__crmAuditMode === "empty";
    const prospects = many ? Array.from({ length: 24 }, (_, index) => ({ kind: "prospect", id: `ui-synthetic-${index}`, companyId: `company-${index}`, companyName: `Firmă sintetică ${index} ` + "Nume foarte lung pentru verificarea reflow ".repeat(8), industry: "Descriere sintetică ".repeat(40), status: "new", statusLabel: "Nou", priority: "normal", contactState: "new", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", nextAction: null })) : [];
    return { view, perspective: "team", records: { actions: [], prospects, opportunities: [] }, pagination: { page: 1, limit: 24, total: prospects.length, pages: 1 }, summary: { activeProspects: prospects.length, activeOpportunities: empty ? 0 : 1, overdue: 0, dueToday: 0, missingAction: 0, wonThisMonth: 0, forecastByLevel: window.__crmAuditMode === "invalid" ? {} : { pipeline: {}, possible: empty ? {} : { EUR: 4000 }, commit: {} } } };
  };
  window.fetch = function(input, options) {
    const requestUrl = typeof input === "string" ? input : input.url;
    if (!String(requestUrl).includes("/api/admin/crm/workspace")) return original.call(this, input, options);
    if (window.__crmAuditMode === "loading") return new Promise((resolve) => { window.__resolveCrmAudit = () => { window.__crmAuditMode = "ready"; resolve(new Response(JSON.stringify(fixture(requestUrl)), { status: 200, headers: { "Content-Type": "application/json" } })); }; });
    if (window.__crmAuditMode === "error") return Promise.resolve(new Response(JSON.stringify({ error: "Eroare sintetică de rețea." }), { status: 503, headers: { "Content-Type": "application/json" } }));
    return Promise.resolve(new Response(JSON.stringify(fixture(requestUrl)), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
}

async function screenshot(client, name) {
  const picture = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(picture.data, "base64"));
}

async function audit(client, context) {
  const result = await evaluate(client, `(${renderedUiAudit.toString()})()`);
  assert.deepEqual(result.critical, [], `${context}: ${JSON.stringify(result)}`);
  if (context.startsWith("crm/")) {
    if (!result.contrastTargets.some((target) => target.text === "Relații comerciale")) await screenshot(client, "failure-" + context.replaceAll("/", "-"));
    assert.ok(result.contrastTargets.some((target) => target.text === "Relații comerciale"), `${context}: CRM heading contrast was not measurable: ${JSON.stringify(result)}`);
  }
  evidence.push({ context, ...result });
}

async function menuChecks() {
  for (const width of [320, 390, 768, 1024, 1279, 1280, 1366, 1440]) {
    const client = await openPage("/admin/crm", width, "light", "ready");
    try {
      await waitForExpression(client, "!!document.querySelector('[data-crm-snapshot=ready]')");
      if (width < 1280) {
        assert.equal(await evaluate(client, "document.querySelector('[data-admin-mobile-menu-trigger]').getAttribute('aria-expanded')"), "false");
        assert.equal(await evaluate(client, "!!document.querySelector('nav.admin-nav').getClientRects().length"), false, "Collapsed mobile navigation must not expose hidden tab stops.");
        await evaluate(client, "document.querySelector('[data-admin-mobile-menu-trigger]').focus()");
        await press(client, "Enter");
        await waitForExpression(client, "document.querySelector('[data-admin-mobile-menu-trigger]').getAttribute('aria-expanded')==='true' && !!document.querySelector('nav.admin-nav').getClientRects().length");
        const targets = await evaluate(client, "Array.from(document.querySelectorAll('nav.admin-nav > a,nav.admin-nav > div > button')).map(element=>{const r=element.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height}})");
        assert.ok(targets.length && targets.every((target) => target.left >= 0 && target.right <= width + 1 && target.height >= 44), "Expanded mobile navigation must wrap every 44px action inside the viewport.");
      }
      const labels = await evaluate(client, "Array.from(document.querySelectorAll('[data-admin-menu-trigger]')).map(e=>e.dataset.adminMenuTrigger)");
      for (const label of labels) {
        await evaluate(client, `document.querySelector('[data-admin-menu-trigger=' + CSS.escape(${JSON.stringify(label)}) + ']').focus()`);
        await press(client, "Enter");
        await waitForExpression(client, `!!document.querySelector('[data-admin-menu=' + CSS.escape(${JSON.stringify(label)}) + ']')`);
        const visible = await evaluate(client, `(() => { const menu = document.querySelector('[data-admin-menu=' + CSS.escape(${JSON.stringify(label)}) + ']'); const first=menu.querySelector('a,button'); const rect=first.getBoundingClientRect();return { hit:first.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)),right:menu.getBoundingClientRect().right,left:menu.getBoundingClientRect().left }; })()`);
        assert.ok(visible.hit && visible.left >= 0 && visible.right <= width + 1, `Menu ${label} at${width} is clipped: ${JSON.stringify(visible)}`);
        await waitForExpression(client, `document.activeElement?.closest('[data-admin-menu]')?.dataset.adminMenu === ${JSON.stringify(label)}`);
        await screenshot(client, `menu-${width}-${label}`);
        if (label === "Financiar" && [390, 768].includes(width)) await exportMenuDialogCheck(client, width);
        await press(client, "Escape");
        await waitForExpression(client, "!document.querySelector('[data-admin-menu]')");
        assert.equal(await evaluate(client, `document.activeElement?.dataset.adminMenuTrigger === ${JSON.stringify(label)}`), true);
      }
      if (width < 1280) {
        await press(client, "Escape");
        await waitForExpression(client, "document.querySelector('[data-admin-mobile-menu-trigger]').getAttribute('aria-expanded')==='false' && !document.querySelector('nav.admin-nav').getClientRects().length");
        assert.equal(await evaluate(client, "document.activeElement===document.querySelector('[data-admin-mobile-menu-trigger]')"), true, "Closing mobile navigation must restore the visible Meniu trigger.");
      }
      evidence.push({ context: `menus/${width}`, passed: true });
    } finally { client.close(); }
  }
}

async function exportMenuDialogCheck(client, width) {
  await evaluate(client, "Array.from(document.querySelectorAll('[data-admin-menu] button')).find(e=>e.textContent.trim()==='Export vanzari').focus()");
  await press(client, "Enter");
  await waitForExpression(client, "!!document.querySelector('[role=dialog]') && !!document.activeElement.closest('[role=dialog]')");
  assert.equal(await evaluate(client, "document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-labelledby'))?.textContent.trim()==='Situatie vanzari'"), true);
  assert.equal(await evaluate(client, "(() => { const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight; })()"), true, "A dialog launched inside a menu must fit the window.");
  await evaluate(client, "Array.from(document.querySelectorAll('[role=dialog] button,input')).filter(e=>!e.disabled).at(-1).focus()");
  await press(client, "Tab");
  assert.equal(await evaluate(client, "!!document.activeElement.closest('[role=dialog]')"), true);
  await screenshot(client, `menu-export-dialog-${width}`);
  await press(client, "Escape");
  await waitForExpression(client, "!document.querySelector('[role=dialog]') && document.activeElement?.textContent.trim()==='Export vanzari'");
}

async function workspaceChecks() {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 390, 768, 1366, 1440]) {
      const client = await openPage("/admin/operational", width, theme);
      try {
        await waitForExpression(client, "!!document.querySelector('#rezervari-workspace')", 90000);
        await wait(300);
        await audit(client, `operational/${theme}/${width}`);
        await screenshot(client, `operational-${theme}-${width}`);
      } finally { client.close(); }
    }
    for (const width of [320, 390, 1440]) {
      for (const mode of ["loading", "error", "invalid", "empty", "many"]) {
        const client = await openPage(mode === "many" ? "/admin/crm?view=prospecting" : "/admin/crm", width, theme, mode);
        try {
          await waitForExpression(client, `!!document.querySelector('[data-crm-snapshot=${mode === "many" || mode === "empty" ? "ready" : mode === "invalid" ? "error" : mode}]')`);
          const values = await evaluate(client, "Array.from(document.querySelectorAll('[data-crm-metric-value]')).map(e=>e.textContent.trim())");
          if (mode === "loading" || mode === "error" || mode === "invalid") assert.ok(values.every((value) => value === "—"), `${mode}: unknown metrics must not show zero`);
          if (mode === "empty") assert.ok(values.every((value) => value === "0"), "Valid zero must remain distinguishable.");
          await audit(client, `crm/${theme}/${width}/${mode}`);
          await screenshot(client, `crm-${theme}-${width}-${mode}`);
          if (mode === "loading") {
            await evaluate(client, "window.__resolveCrmAudit()");
            await waitForExpression(client, "!!document.querySelector('[data-crm-snapshot=ready]')");
          }
          if (mode === "error" || mode === "invalid") {
            await evaluate(client, "window.__crmAuditMode='ready';Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Reîncearcă').click()");
            await waitForExpression(client, "!!document.querySelector('[data-crm-snapshot=ready]')");
          }
          if (mode === "many") await modalCheck(client);
        } finally { client.close(); }
      }
    }
  }
}

async function modalCheck(client) {
  await evaluate(client, "(() => {const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Prospect nou');b.focus();b.click()})()");
  await waitForExpression(client, "!!document.querySelector('[role=dialog] [data-modal-focus-sentinel]')");
  assert.equal(await evaluate(client, "(() => {const d=document.querySelector('[role=dialog]');return !!d.getAttribute('aria-label') || !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()})()"), true, "Modal needs accessible name.");
  await evaluate(client, "(() => { const d=document.querySelector('[role=dialog]');const f=Array.from(d.querySelectorAll('button,input,select,textarea,a[href]')).filter(e=>!e.disabled&&e.getClientRects().length);f.at(-1).focus();})()");
  await press(client, "Tab");
  assert.equal(await evaluate(client, "!!document.activeElement.closest('[role=dialog]')"), true, "Tab escaped modal.");
  await press(client, "Tab", 8);
  assert.equal(await evaluate(client, "!!document.activeElement.closest('[role=dialog]')"), true, "Shift+Tab escaped modal.");
  await press(client, "Escape");
  await waitForExpression(client, "!document.querySelector('[role=dialog]')");
  assert.equal(await evaluate(client, "document.activeElement?.textContent.trim()==='Prospect nou'"), true, "Focus must return to opener.");
}

async function sharedModalChecks() {
  const tsxRequire = createRequire(require.resolve("tsx/package.json"));
  const esbuild = tsxRequire("esbuild");
  const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{EscapeCloseHandler}from'${path.resolve('src/hooks/use-escape-close.tsx').replace(/\\/g,'/')}';function Fixture(){const[a,A]=useState(false),[b,B]=useState(false),[busy,S]=useState(false);return <main><button id="open" onClick={()=>A(true)}>Deschide</button><button id="background">Fundal</button>{a?<div role="dialog" aria-modal="true"><EscapeCloseHandler onClose={()=>A(false)}/><h2>Dialog principal</h2><input autoFocus/><button id="nested" onClick={()=>B(true)}>Dialog secundar</button>{b?<div role="dialog" aria-modal="true"><EscapeCloseHandler onClose={()=>B(false)} enabled={!busy}/><h2>Dialog secundar</h2><button tabIndex={-1}>Exclus din tabulare</button><fieldset disabled><button>Control indisponibil</button></fieldset><button id="busy" onClick={()=>S(!busy)}>Salvare {busy?'ocupată':'liberă'}</button><button id="last">Ultimul control</button></div>:null}</div>:null}</main>}createRoot(document.getElementById('root')).render(<Fixture/>);`;
  const bundle = await esbuild.build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" });
  fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/fixture.js" ? bundle.outputFiles[0].text : '<!doctype html><html lang="ro"><head><title>Fixture modal sintetic</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`;
  const target = await createTarget(fixtureUrl);
  const client = connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await waitForExpression(client, "!!document.getElementById('open')");
    await evaluate(client, "document.getElementById('open').focus();document.getElementById('open').click()");
    await waitForExpression(client, "document.querySelectorAll('[role=dialog]').length===1");
    assert.equal(await evaluate(client, "document.getElementById('background').inert"), true);
    await evaluate(client, "document.getElementById('nested').focus();document.getElementById('nested').click()");
    await waitForExpression(client, "document.querySelectorAll('[role=dialog]').length===2");
    await evaluate(client, "document.getElementById('busy').click();document.getElementById('last').focus()");
    await press(client, "Tab");
    assert.equal(await evaluate(client, "document.activeElement.id==='busy'"), true, "Busy dialog still traps focus.");
    await press(client, "Escape");
    assert.equal(await evaluate(client, "document.querySelectorAll('[role=dialog]').length"), 2, "Busy child must consume Escape without closing parent.");
    await evaluate(client, "document.getElementById('busy').click()");
    await press(client, "Escape");
    await waitForExpression(client, "document.querySelectorAll('[role=dialog]').length===1");
    assert.equal(await evaluate(client, "document.activeElement.id==='nested'"), true);
    await press(client, "Escape");
    await waitForExpression(client, "!document.querySelector('[role=dialog]')");
    assert.equal(await evaluate(client, "document.activeElement.id==='open' && !document.getElementById('background').inert"), true);
    evidence.push({ context: "shared-modal/stacked-saving", passed: true });
    await evaluate(client, "(() => {const e=document.createElement('div');e.id='intentional-ui-regression';e.dataset.uiStructural='';e.style.cssText='width:2000px;height:40px;background:white;color:white';e.setAttribute('data-ui-contrast','');e.textContent='Fixture de contrast insuficient';document.body.prepend(e)})()");
    const rejected = await evaluate(client, `(${renderedUiAudit.toString()})()`);
    assert.ok(rejected.contrastFailures.length && rejected.overflowFailures.length, "The visual gate must reject deliberately unreadable, clipped fixtures.");
    await evaluate(client, "document.getElementById('intentional-ui-regression').remove()");
    evidence.push({ context: "visual-gate/rejects-known-bad-fixture", passed: true });
  } finally { client.close(); }
}

let sessionCookie;
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", origin: base }, body: JSON.stringify({ email: "coo.preview@focusmedia.test", password: process.env.PREVIEW_TEST_PASSWORD }) });
  assert.equal(login.status, 200, "Synthetic COO login failed.");
  sessionCookie = login.headers.get("set-cookie")?.split(";")[0];assert.ok(sessionCookie);
  chrome = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${temp}`, "about:blank"], { stdio: "ignore" });
  await waitForChrome();
  await menuChecks();
  await workspaceChecks();
  await sharedModalChecks();
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ passed: true, synthetic: true, baseUrl: base, browserBypassesCspForDev: process.env.UI_TEST_BROWSER_BYPASS_CSP === "true", coverage: ["menu-hit-targets", "structural-reflow", "targeted-text-contrast", "modal-name-focus-stack-busy", "crm-loading-error-malformed-empty-long-data"], fullWcagCertification: false, checks: evidence }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: evidence.length, output }));
}

function loadEnv(file) {
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");if (i < 1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, i).trim();if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
main().catch((error) => { console.error(error.stack);process.exitCode = 1; }).finally(async () => {
  if (chrome) chrome.kill();
  if (fixtureServer) fixtureServer.closeAllConnections();
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
