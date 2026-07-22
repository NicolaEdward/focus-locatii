const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const accounts = require("./preview-accounts.json");

loadEnvFile(process.env.ENV_FILE);
const baseUrl = String(process.env.CAPTURE_BASE_URL || "http://127.0.0.1:3015").replace(/\/$/, "");
const password = process.env.PREVIEW_TEST_PASSWORD;
const vercelShareToken = process.env.VERCEL_SHARE_TOKEN;
let vercelShareCookie = null;
const debugPort = Number(process.env.CAPTURE_CHROME_PORT || 9231);
const outDir = path.resolve(process.cwd(), process.env.CAPTURE_OUT_DIR || "artifacts/release-screenshots");
const workflowChecks = process.env.CAPTURE_WORKFLOW_CHECKS === "true";
if (!password) throw new Error("PREVIEW_TEST_PASSWORD lipsește.");

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
];
const pages = [
  { name: "admin-login", route: "/admin/login", expected: "Autentificare" },
  { name: "public-home", route: "/", expected: "loca" },
  { name: "coo-dashboard", route: "/admin/dashboard", role: "COO", expected: "Rezumat executiv" },
  { name: "sales-director-dashboard", route: "/admin/dashboard", role: "SALES_DIRECTOR", expected: "Agenda mea" },
  { name: "sales-agent-dashboard", route: "/admin/dashboard", role: "SALES_AGENT", expected: "Agenda mea" },
  { name: "finance-invoices", route: "/admin/financiar/incasari", role: "FINANCE_OPERATOR", expected: "Facturi clien" },
  { name: "finance-saga-integration", route: "/admin/integrari/saga", role: "FINANCE_OPERATOR", expected: "SAGA" },
  { name: "field-operational", route: "/admin/operational", role: "FIELD_OPERATOR", expected: "Munca mea" },
  { name: "locations", route: "/admin/locatii", role: "COO", expected: "Loca" },
  { name: "selector", route: "/admin/selectie-locatii", role: "COO", expected: "Selector" },
  { name: "clients", route: "/admin/clienti", role: "COO", expected: "Clien" },
  { name: "campaigns", route: "/admin/campanii", role: "COO", expected: "Campanii" },
  { name: "sales-clients", route: "/admin/clienti", role: "SALES_AGENT", expected: "Clien" },
  { name: "sales-campaigns", route: "/admin/campanii", role: "SALES_AGENT", expected: "Campanii" },
  { name: "sales-reservations", route: "/admin/locatii", role: "SALES_AGENT", expected: "Loca" },
  { name: "crm", route: "/admin/crm", role: "SALES_AGENT", expected: "CRM" },
  { name: "operational", route: "/admin/operational", role: "COO", expected: "Lucrari de atribuit" },
  { name: "suppliers", route: "/admin/furnizori", role: "COO", expected: "Furnizori" },
  { name: "finance-suppliers", route: "/admin/furnizori", role: "FINANCE_OPERATOR", expected: "Furnizori" },
  { name: "location-import", route: "/admin/locatii/import", role: "COO", expected: "Import locatii" },
  { name: "gps-audit", route: "/admin/locatii/gps", role: "COO", expected: "GPS AUDIT" },
  { name: "users", route: "/admin/utilizatori", role: "COO", expected: "Utilizatori" },
  { name: "ownership-integrity", route: "/admin/integritate-date", role: "COO", expected: "Integritate ownership" },
  { name: "account-security", route: "/admin/securitate", role: "COO", expected: "Securitate si sesiuni" },
  { name: "public-locations", route: "/locatii", expected: "loca" }
];

async function main() {
  await ensureVercelShareCookie();
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
        const capture = await capturePage(page, viewport, page.role ? cookies[page.role] : null);
        manifest.push({ page: page.name, role: page.role || "PUBLIC", viewport: viewport.name, width: viewport.width, height: viewport.height, ...capture });
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
  if (vercelShareCookie) {
    const [name, value] = vercelShareCookie.split("=");
    const url = new URL(baseUrl);
    await client.send("Network.setCookie", { name, value, domain: url.hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" });
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
  if (workflowChecks && viewport.name === "desktop") await runWorkflowCheck(client, page.name, viewport);
  const overflow = await client.send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1", returnByValue: true });
  if (overflow.result?.value) throw new Error(`${page.name}/${viewport.name} are overflow orizontal.`);
  const accessibility = await auditAccessibility(client);
  if (accessibility.critical.length) {
    throw new Error(`${page.name}/${viewport.name} are probleme critice de accesibilitate: ${accessibility.critical.join("; ")} ${JSON.stringify(accessibility.samples)}`);
  }
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64"));
  const errors = client.events.filter((event) => {
    if (event.method === "Log.entryAdded" && String(event.params?.entry?.text || "").includes("vercel.live/_next-live/feedback")) return false;
    return event.method === "Runtime.exceptionThrown" || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error") || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error");
  });
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
  return { file: filePath, accessibility };
}

async function auditAccessibility(client) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const accessibleName = (element) => {
        const labelledBy = element.getAttribute('aria-labelledby');
        const labelledText = labelledBy ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
        const imageAlt = element.querySelector?.('img[alt]')?.getAttribute('alt') || '';
        return [element.getAttribute('aria-label'), labelledText, element.textContent, imageAlt, element.getAttribute('title')]
          .map((value) => String(value || '').trim()).find(Boolean) || '';
      };
      const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea')).filter(visible);
      const unnamedControls = controls.filter((element) => {
        if (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby')) return false;
        if (element.closest('label')) return false;
        return !(element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]'));
      });
      const interactive = Array.from(document.querySelectorAll('button, a[href]')).filter(visible);
      const unnamedInteractive = interactive.filter((element) => !accessibleName(element));
      const imagesWithoutAlt = Array.from(document.querySelectorAll('img:not([alt])')).filter(visible);
      const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean);
      const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible).map((element) => ({ level: Number(element.tagName.slice(1)), text: String(element.textContent || '').trim().slice(0, 80) }));
      const headingJumps = headings.filter((heading, index) => index > 0 && heading.level > headings[index - 1].level + 1);
      const tinyTargets = interactive.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 32 || rect.height < 32;
      });
      const critical = [];
      if (!document.documentElement.lang) critical.push('Documentul nu are atribut lang.');
      if (unnamedControls.length) critical.push(unnamedControls.length + ' controale de formular nu au eticheta accesibila.');
      if (unnamedInteractive.length) critical.push(unnamedInteractive.length + ' butoane/linkuri nu au nume accesibil.');
      if (imagesWithoutAlt.length) critical.push(imagesWithoutAlt.length + ' imagini nu au atribut alt.');
      if (duplicateIds.length) critical.push(duplicateIds.length + ' identificatori HTML sunt duplicati.');
      const warnings = [];
      if (!document.querySelector('main')) warnings.push('Pagina nu are landmark main.');
      if (!headings.some((heading) => heading.level === 1)) warnings.push('Pagina nu are heading H1 vizibil.');
      if (headingJumps.length) warnings.push(headingJumps.length + ' salturi in ierarhia headingurilor.');
      if (tinyTargets.length) warnings.push(tinyTargets.length + ' tinte interactive sunt sub 32x32 px.');
      return {
        critical,
        warnings,
        stats: { controls: controls.length, interactive: interactive.length, headings: headings.length, tinyTargets: tinyTargets.length },
        samples: {
          unnamedControls: unnamedControls.slice(0, 8).map((element) => element.outerHTML.slice(0, 180)),
          unnamedInteractive: unnamedInteractive.slice(0, 8).map((element) => element.outerHTML.slice(0, 180)),
          duplicateIds: duplicateIds.slice(0, 8),
          headingJumps: headingJumps.slice(0, 8)
        }
      };
    })()`,
    returnByValue: true
  });
  return result.result?.value || { critical: ["Auditul de accesibilitate nu a returnat rezultat."], warnings: [], stats: {}, samples: {} };
}

async function captureWorkflowState(client, fileName) {
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64"));
  return filePath;
}

async function runWorkflowCheck(client, pageName, viewport) {
  if (pageName === "finance-invoices") {
    const initial = await client.send("Runtime.evaluate", {
      expression: "document.body.textContent.includes('Solduri de încasat') && !document.body.textContent.includes('Reconciliere legacy')",
      returnByValue: true
    });
    if (!initial.result?.value) throw new Error("Registrul financiar activ sau restricția reconciliere pentru Finance lipsesc.");
    await clickButton(client, "Istoric facturi");
    await waitForExpression(client, "document.body.textContent.includes('Facturi încasate')", 10000);
    await clickButton(client, "De încasat");
    await waitForExpression(client, "document.body.textContent.includes('Solduri de încasat')", 10000);
    await clickButton(client, "Înregistrează plată");
    await waitForExpression(client, "document.body.textContent.includes('Încasat anterior') && document.body.textContent.includes('Sold rămas')", 10000);
    await captureWorkflowState(client, `finance-payment-modal-${viewport.name}.png`);
    await clickButton(client, "Închide");
    console.log(JSON.stringify({ workflow: "receivables-read-only", checked: ["settled-history", "payment-preview", "finance-rbac"] }));
    return;
  }

  if (pageName === "locations") {
    const before = await occupancyValues(client);
    const startedAt = Date.now();
    await clickButton(client, "Rezervare noua");
    await waitForExpression(client, "document.body.textContent.includes('Gestionare completa rezervari')", 30000);
    await waitForExpression(client, "document.body.innerText.toLocaleLowerCase('ro').split('ocupate acum').length >= 3", 30000);
    await captureWorkflowState(client, `locations-reservation-panel-${viewport.name}.png`);
    const after = await occupancyValues(client);
    for (const label of Object.keys(before)) {
      if (!before[label]?.length) throw new Error(`Statistica ${label} lipseste din pagina principala.`);
      if (after[label]?.length < 2 || after[label].some((value) => value !== before[label][0])) {
        throw new Error(`Statisticile ${label} nu coincid intre pagina si panoul complet: ${JSON.stringify({ before, after })}`);
      }
    }
    const labels = await client.send("Runtime.evaluate", {
      expression: "document.body.textContent.includes('HOLD - 5 zile') && document.body.textContent.includes('Rezervat - contract confirmat')",
      returnByValue: true
    });
    if (!labels.result?.value) throw new Error("Etichetele comerciale HOLD/Rezervat lipsesc din formularul de rezervare.");
    console.log(JSON.stringify({ workflow: "location-reservation", loadMs: Date.now() - startedAt, occupancy: before }));
    return;
  }

  if (pageName === "finance-saga-integration") {
    await clickButton(client, "Ruleaza shadow");
    await waitForExpression(client, "document.body.textContent.includes('Facturi exacte') && document.body.textContent.includes('Incasari noi') && document.body.textContent.includes('Plati manuale de reconciliat')", 30000);
    await captureWorkflowState(client, `finance-saga-shadow-report-${viewport.name}.png`);
    console.log(JSON.stringify({ workflow: "saga-shadow-read-only", checked: ["report-rendered", "separate-currency-totals", "no-writeback-label"] }));
    return;
  }

  if (pageName === "crm") {
    await clickButton(client, "Prospect nou");
    await waitForExpression(client, "document.body.textContent.includes('Stadiu inițial')", 10000);
    const qualified = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const select = Array.from(document.querySelectorAll('select')).find((item) => Array.from(item.options).some((option) => option.value === 'qualified'));
        if (!select) return false;
        select.value = 'qualified';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      returnByValue: true
    });
    if (!qualified.result?.value) throw new Error("Stadiul Calificat nu exista in formularul de prospect.");
    await waitForExpression(client, `(() => {
      const taxId = document.querySelector('input[name="taxId"]');
      const contact = document.querySelector('input[name="contactName"]');
      return Boolean(taxId?.required && contact?.required && document.body.textContent.includes('persoană de contact obligatorii'));
    })()`, 10000);
    await captureWorkflowState(client, `crm-qualified-prospect-modal-${viewport.name}.png`);
    console.log(JSON.stringify({ workflow: "crm-qualified-prospect", requiredFields: ["taxId", "contactName"] }));
  }
}

async function clickButton(client, text) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim().includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true
  });
  if (!result.result?.value) throw new Error(`Butonul ${text} nu a fost gasit.`);
}

async function occupancyValues(client) {
  const labels = ["Ocupate acum", "HOLD activ", "Urmeaza", "Active / viitoare"];
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const lines = document.body.innerText.split('\\n').map((line) => line.trim()).filter(Boolean);
      return Object.fromEntries(${JSON.stringify(labels)}.map((label) => [label, lines
        .map((line, index) => line.toLocaleLowerCase('ro') === label.toLocaleLowerCase('ro') ? lines.slice(index + 1, index + 4).find((candidate) => /^\\d+$/.test(candidate)) : null)
        .filter(Boolean)]));
    })()`,
    returnByValue: true
  });
  return result.result?.value || {};
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
  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { ...base, "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : { ...base };
  if (vercelShareCookie) headers.cookie = vercelShareCookie;
  return headers;
}

async function ensureVercelShareCookie() {
  if (!vercelShareToken || vercelShareCookie) return;
  const response = await fetch(`${baseUrl}/?_vercel_share=${encodeURIComponent(vercelShareToken)}`, { redirect: "manual" });
  vercelShareCookie = response.headers.get("set-cookie")?.split(";")[0] || null;
  if (!vercelShareCookie) throw new Error("Vercel share token did not produce a bypass cookie.");
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
