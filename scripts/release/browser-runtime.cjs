const fs = require("node:fs");

function createBrowserRuntime(debugPort) {
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
  return { findChrome, waitForChrome, createTarget, connect, waitForExpression, wait };
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
      const item = pending.get(payload.id);
      pending.delete(payload.id);
      clearTimeout(item.timeout);
      payload.error ? item.reject(new Error(payload.error.message)) : item.resolve(payload.result);
    } else if (payload.method) events.push(payload);
  });
  socket.addEventListener("close", () => {
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error("Chrome connection closed.")); }
    pending.clear();
  });
  return {
    events,
    async send(method, params = {}) {
      await ready;
      const callId = ++id;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { if (pending.delete(callId)) reject(new Error(`CDP timeout: ${method}`)); }, 20000);
        pending.set(callId, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id: callId, method, params }));
      });
    },
    close() {
      socket.close();
      const endpoint = new URL(wsUrl);
      const targetId = endpoint.pathname.split("/").at(-1);
      // Closing only the socket leaves every captured tab and polling timer alive.
      void fetch(`http://${endpoint.host}/json/close/${encodeURIComponent(targetId)}`).catch(() => undefined);
    }
  };
}

async function waitForExpression(client, expression, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return;
    await wait(100);
  }
  throw new Error(`Timeout: ${expression}`);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
module.exports = { createBrowserRuntime };
