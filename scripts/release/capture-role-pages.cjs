const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const accounts = require("./preview-accounts.json");

loadEnvFile(process.env.ENV_FILE);
const baseUrl = String(process.env.CAPTURE_BASE_URL || "http://127.0.0.1:3015").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD;
const debugPort = Number(process.env.CAPTURE_CHROME_PORT || 9231);
const outDir = path.resolve(process.cwd(), process.env.CAPTURE_OUT_DIR || "artifacts/release-screenshots");
if (!password) throw new Error("PREVIEW_TEST_PASSWORD lipsește.");

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
];
const pages = [
  { name: "coo-dashboard", route: "/admin/dashboard", role: "COO", expected: "Rezumat executiv" },
  { name: "sales-director-dashboard", route: "/admin/dashboard", role: "SALES_DIRECTOR", expected: "Agenda mea" },
  { name: "sales-agent-dashboard", route: "/admin/dashboard", role: "SALES_AGENT", expected: "Agenda mea" },
  { name: "finance-invoices", route: "/admin/financiar/incasari", role: "FINANCE_OPERATOR", expected: "Facturi clien" },
  { name: "field-operational", route: "/admin/operational", role: "FIELD_OPERATOR", expected: "Munca mea" },
  { name: "locations", route: "/admin/locatii", role: "COO", expected: "Loca" },
  { name: "selector", route: "/admin/selectie-locatii", role: "COO", expected: "Selector" },
  { name: "clients", route: "/admin/clienti", role: "COO", expected: "Clien" },
  { name: "campaigns", route: "/admin/campanii", role: "COO", expected: "Campanii" },
  { name: "crm", route: "/admin/crm", role: "SALES_AGENT", expected: "CRM" },
  { name: "operational", route: "/admin/operational", role: "COO", expected: "Lucrari de atribuit" },
  { name: "ownership-integrity", route: "/admin/integritate-date", role: "COO", expected: "Integritate ownership" },
  { name: "public-locations", route: "/locatii", expected: "loca" }
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const chromePath = findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-release-chrome-"));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, "about:blank"], { stdio: "ignore" });
  try {
    await waitForChrome();
    const cookies = {};
    for (const account of accounts) cookies[account.role] = await login(account.email);
    const publicPayload = await requestJson("/api/locations");
    const publicLocations = Array.isArray(publicPayload) ? publicPayload : publicPayload.locations;
    if (!Array.isArray(publicLocations) || !publicLocations.length) throw new Error("Nu există locație publică pentru captură.");
    pages.push({ name: "public-detail", route: `/locatii/${encodeURIComponent(publicLocations[0].id || publicLocations[0].code)}`, expected: "Preview" });

    const manifest = [];
    const pageFilter = String(process.env.CAPTURE_PAGE_FILTER || "").trim();
    const selectedPages = pageFilter ? pages.filter((page) => page.name.includes(pageFilter)) : pages;
    if (!selectedPages.length) throw new Error(`No capture page matches CAPTURE_PAGE_FILTER=${pageFilter}.`);
    for (const page of selectedPages) {
      for (const viewport of viewports) {
        const file = await capturePage(page, viewport, page.role ? cookies[page.role] : null);
        manifest.push({ page: page.name, role: page.role || "PUBLIC", viewport: viewport.name, width: viewport.width, height: viewport.height, file });
      }
    }
    const manifestPath = path.join(outDir, "manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, chromePath, captures: manifest }, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, captureCount: manifest.length, outDir, manifestPath }, null, 2));
  } finally {
    chrome.kill();
    await wait(300);
    if (!chrome.killed) chrome.kill("SIGKILL");
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch (error) {
      console.warn(`Chrome temporary profile cleanup was deferred: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function capturePage(page, viewport, cookie) {
  const target = await createTarget("about:blank");
  const client = connect(target.webSocketDebuggerUrl);
  const filePath = path.join(outDir, `${page.name}-${viewport.name}.png`);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 700 });
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    await client.send("Network.setExtraHTTPHeaders", { headers: { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET, "x-vercel-set-bypass-cookie": "true" } });
  }
  if (cookie) {
    const [name, value] = cookie.split("=");
    const url = new URL(baseUrl);
    await client.send("Network.setCookie", { name, value, domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" });
  }
  await client.send("Page.navigate", { url: `${baseUrl}${page.route}` });
  await waitForExpression(client, "document.readyState === 'complete'", 30000);
  await wait(1200);
  const result = await client.send("Runtime.evaluate", { expression: `document.body.innerText.toLocaleLowerCase('ro').includes(${JSON.stringify(page.expected.toLocaleLowerCase("ro"))})`, returnByValue: true });
  if (result.result?.value !== true) {
    const snippet = await client.send("Runtime.evaluate", { expression: "document.body.innerText.slice(0, 800)", returnByValue: true });
    throw new Error(`${page.name}/${viewport.name} nu conține «${page.expected}»: ${snippet.result?.value || ""}`);
  }
  const overflow = await client.send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1", returnByValue: true });
  if (overflow.result?.value) throw new Error(`${page.name}/${viewport.name} are overflow orizontal.`);
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64"));
  const errors = client.events.filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error") || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error"));
  const failedRequestIds = errors.map((event) => event.params?.entry?.networkRequestId).filter(Boolean);
  const failedBodies = [];
  for (const requestId of failedRequestIds) {
    const body = await client.send("Network.getResponseBody", { requestId }).catch(() => null);
    if (body) failedBodies.push({ requestId, body: body.body?.slice(0, 500) });
  }
  const requestDiagnostics = client.events
    .filter((event) => event.method === "Network.requestWillBeSent" && failedRequestIds.includes(event.params?.requestId))
    .map((event) => ({
      requestId: event.params.requestId,
      method: event.params.request.method,
      url: event.params.request.url,
      origin: event.params.request.headers?.Origin || event.params.request.headers?.origin || null,
      referer: event.params.request.headers?.Referer || event.params.request.headers?.referer || null,
    }));
  client.close();
  if (errors.length) console.error(JSON.stringify({ errors: errors.map((event) => ({ method: event.method, params: event.params })), requestDiagnostics, failedBodies }, null, 2));
  if (errors.length) throw new Error(`${page.name}/${viewport.name} are ${errors.length} erori console/runtime.`);
  return filePath;
}

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: requestHeaders({ "content-type": "application/json" }), body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`Login vizual eșuat pentru ${email}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`Cookie lipsă pentru ${email}.`);
  return cookie;
}

async function requestJson(route) {
  const response = await fetch(`${baseUrl}${route}`, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`${route} a răspuns ${response.status}.`);
  return response.json();
}

function requestHeaders(base = {}) {
  return process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { ...base, "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : base;
}

function findChrome() {
  const candidates = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome/Chromium nu a fost găsit. Setează CHROME_PATH.");
  return found;
}

async function waitForChrome() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) return; } catch {}
    await wait(250);
  }
  throw new Error("Chrome CDP nu a pornit.");
}

async function createTarget(url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Nu am putut crea target Chrome: ${response.status}`);
  return response.json();
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let id = 0;
  const ready = new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const item = pending.get(payload.id); pending.delete(payload.id);
      payload.error ? item.reject(new Error(payload.error.message)) : item.resolve(payload.result);
    } else if (payload.method) events.push(payload);
  });
  return {
    events,
    async send(method, params = {}) {
      await ready; const callId = ++id; socket.send(JSON.stringify({ id: callId, method, params }));
      return new Promise((resolve, reject) => { pending.set(callId, { resolve, reject }); setTimeout(() => { if (pending.delete(callId)) reject(new Error(`CDP timeout: ${method}`)); }, 15000); });
    },
    close() { socket.close(); }
  };
}

async function waitForExpression(client, expression, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return;
    await wait(250);
  }
  throw new Error(`Timeout: ${expression}`);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function loadEnvFile(fileName) {
  if (!fileName) return;
  const filePath = path.resolve(process.cwd(), fileName);
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim(); if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("="); if (separator < 1) continue;
    const key = line.slice(0, separator).trim(); const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
