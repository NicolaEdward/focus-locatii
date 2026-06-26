const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const NODE_BIN = process.execPath;
const NEXT_BIN = require.resolve("next/dist/bin/next");
const PORT = Number(process.env.VISUAL_SMOKE_PORT || 3013);
const DEBUG_PORT = Number(process.env.VISUAL_CHROME_PORT || 9223);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = path.join(process.cwd(), "tmp", "visual-smoke");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadLocalEnv() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    const contents = fs.readFileSync(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/db`);
      if (response.ok) return;
    } catch {
      // Wait until Next is ready.
    }
    await wait(500);
  }
  throw new Error("Next server did not become ready.");
}

async function waitForChrome() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // Wait until Chrome debugging is ready.
    }
    await wait(300);
  }
  throw new Error("Chrome debugging did not become ready.");
}

async function createTarget(url) {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
  if (!response.ok) throw new Error(`Could not create Chrome target: ${response.status}`);
  return response.json();
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];

  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
      return;
    }
    if (payload.method) events.push(payload);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    events,
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 10000);
      });
    },
    close() {
      socket.close();
    }
  };
}

async function loginCookie(email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password
    })
  });
  assert(response.ok, "Login failed for visual smoke.");
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function inspectPage({ name, url, width, height, adminCookie, expectedText }) {
  const target = await createTarget("about:blank");
  const client = connect(target.webSocketDebuggerUrl);
  const screenshotPath = path.join(OUT_DIR, `${name}.png`);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700
  });

  if (adminCookie) {
    const [cookieName, cookieValue] = adminCookie.split("=");
    await client.send("Network.setCookie", {
      name: cookieName,
      value: cookieValue,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    });
  }

  await client.send("Page.navigate", { url });
  await waitForExpression(client, "document.readyState === 'complete'");
  await wait(5000);

  const textCheck = await client.send("Runtime.evaluate", {
    expression: `document.body.innerText.toLowerCase().includes(${JSON.stringify(expectedText.toLowerCase())})`,
    returnByValue: true
  });
  if (textCheck.result?.value !== true) {
    const textSnippet = await client.send("Runtime.evaluate", {
      expression: "document.body.innerText.slice(0, 700)",
      returnByValue: true
    });
    throw new Error(`${name} missing expected text: ${expectedText}. Text snippet: ${textSnippet.result?.value || ""}`);
  }

  const mapCheck = await client.send("Runtime.evaluate", {
    expression: "Boolean(document.querySelector('.leaflet-container'))",
    returnByValue: true
  });
  if (name.startsWith("public")) assert(mapCheck.result?.value === true, `${name} did not render the map container`);

  const overflowCheck = await client.send("Runtime.evaluate", {
    expression: "(() => { const before = window.scrollX; window.scrollTo(100000, 0); const overflow = window.scrollX > 0; window.scrollTo(before, 0); return !overflow; })()",
    returnByValue: true
  });
  assert(overflowCheck.result?.value === true, `${name} has horizontal page overflow`);

  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const errors = client.events
    .filter((event) => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Runtime.consoleAPICalled") return event.params?.type === "error";
      if (event.method === "Log.entryAdded") return event.params?.entry?.level === "error";
      return false;
    })
    .map((event) => {
      if (event.method === "Log.entryAdded") {
        const entry = event.params?.entry;
        return `${entry?.text || event.method}${entry?.url ? ` (${entry.url})` : ""}`;
      }
      if (event.method === "Runtime.consoleAPICalled") {
        return event.params?.args?.map((arg) => arg.value || arg.description).join(" ") || event.method;
      }
      return event.params?.exceptionDetails?.text || event.method;
    });

  client.close();
  assert(errors.length === 0, `${name} has console/runtime errors: ${errors.join(", ")}`);
  return screenshotPath;
}

async function inspectFinancialTab({ adminCookie }) {
  const target = await createTarget("about:blank");
  const client = connect(target.webSocketDebuggerUrl);
  const screenshotPath = path.join(OUT_DIR, "coo-financial-tab-desktop.png");

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false
  });

  const [cookieName, cookieValue] = adminCookie.split("=");
  await client.send("Network.setCookie", {
    name: cookieName,
    value: cookieValue,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    sameSite: "Lax"
  });

  await client.send("Page.navigate", { url: `${BASE_URL}/admin/dashboard` });
  await waitForExpression(client, "document.readyState === 'complete'");
  await wait(2500);
  await client.send("Runtime.evaluate", {
    expression: `Array.from(document.querySelectorAll('button')).find((button) => button.innerText.trim().toLowerCase() === 'financiar')?.click()`
  });
  await waitForExpression(client, "document.body.innerText.toLowerCase().includes('upload raport zilnic')");

  const overflowCheck = await client.send("Runtime.evaluate", {
    expression: "(() => { const before = window.scrollX; window.scrollTo(100000, 0); const overflow = window.scrollX > 0; window.scrollTo(before, 0); return !overflow; })()",
    returnByValue: true
  });
  assert(overflowCheck.result?.value === true, "coo financial tab has horizontal page overflow");

  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const errors = client.events
    .filter((event) => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Runtime.consoleAPICalled") return event.params?.type === "error";
      if (event.method === "Log.entryAdded") return event.params?.entry?.level === "error";
      return false;
    })
    .map((event) => event.params?.entry?.text || event.params?.exceptionDetails?.text || event.method);

  client.close();
  assert(errors.length === 0, `coo financial tab has console/runtime errors: ${errors.join(", ")}`);
  return screenshotPath;
}

async function waitForExpression(client, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true
    });
    if (result.result?.value === true) return;
    await wait(300);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function main() {
  loadLocalEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), "focus-chrome-"));
  const prisma = new PrismaClient();
  let temporaryCooId = null;

  const server = spawn(NODE_BIN, [NEXT_BIN, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${chromeUserData}`,
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  try {
    await waitForServer();
    await waitForChrome();
    const adminCookie = await loginCookie();
    const cooEmail = `visual-coo-${Date.now()}@focusmedia.test`;
    const cooPassword = `Visual-${Date.now()}-COO!`;
    const cooResponse = await fetch(`${BASE_URL}/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ name: "Visual COO", email: cooEmail, password: cooPassword, role: "COO" })
    });
    assert(cooResponse.ok, "Could not create temporary COO for visual smoke.");
    temporaryCooId = (await cooResponse.json()).user.id;
    const cooCookie = await loginCookie(cooEmail, cooPassword);
    const screenshots = [];

    screenshots.push(
      await inspectPage({
        name: "public-desktop",
        url: `${BASE_URL}/locatii`,
        width: 1440,
        height: 1000,
        expectedText: "Media plan"
      })
    );
    screenshots.push(
      await inspectPage({
        name: "dashboard-desktop",
        url: `${BASE_URL}/admin/dashboard`,
        width: 1440,
        height: 1000,
        adminCookie,
        expectedText: "Buna, Administrator"
      })
    );
    screenshots.push(
      await inspectPage({
        name: "coo-command-center-desktop",
        url: `${BASE_URL}/admin/dashboard`,
        width: 1440,
        height: 1100,
        adminCookie: cooCookie,
        expectedText: "Control operational OOH"
      })
    );
    screenshots.push(await inspectFinancialTab({ adminCookie: cooCookie }));
    screenshots.push(
      await inspectPage({
        name: "dashboard-mobile",
        url: `${BASE_URL}/admin/dashboard`,
        width: 390,
        height: 844,
        adminCookie,
        expectedText: "Buna, Administrator"
      })
    );
    screenshots.push(
      await inspectPage({
        name: "public-mobile",
        url: `${BASE_URL}/locatii`,
        width: 390,
        height: 844,
        expectedText: "Selectie locatii"
      })
    );
    screenshots.push(
      await inspectPage({
        name: "admin-desktop",
        url: `${BASE_URL}/admin/locatii`,
        width: 1440,
        height: 1100,
        adminCookie,
        expectedText: "Vanzari inchise in luna selectata"
      })
    );

    console.log(JSON.stringify({ ok: true, screenshots }, null, 2));
  } finally {
    if (temporaryCooId) await prisma.user.delete({ where: { id: temporaryCooId } }).catch(() => null);
    await prisma.$disconnect();
    server.kill();
    chrome.kill();
    await wait(500);
    if (!server.killed) server.kill("SIGKILL");
    if (!chrome.killed) chrome.kill("SIGKILL");
    fs.rmSync(chromeUserData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
