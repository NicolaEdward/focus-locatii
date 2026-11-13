const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { chromium } = require("playwright");
const { createBrowserRuntime } = require("./release/browser-runtime.cjs");

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || createBrowserRuntime(0).findChrome(), headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    await page.setContent("<title>Local synthetic proof-photo verification</title>");
    const compile = (name) => ts.transpileModule(fs.readFileSync(name, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const result = await page.evaluate(async (sources) => {
      const modules = {};
      for (const [name, source] of sources) { const exports = {}; new Function("require", "exports", source)((key) => { if (!modules[key]) throw Error("Unexpected dependency " + key); return modules[key]; }, exports); modules[name] = exports; }
      const prepare = modules["client"].prepareOperationalProofUpload;
      const canvas = document.createElement("canvas"); canvas.width = 2200; canvas.height = 2200;
      const context = canvas.getContext("2d"); const pixels = context.createImageData(canvas.width, canvas.height);
      let state = 48127;
      for (let i = 0; i < pixels.data.length; i += 4) { state = (state * 1664525 + 1013904223) >>> 0; pixels.data[i] = state & 255; pixels.data[i + 1] = state >>> 8 & 255; pixels.data[i + 2] = state >>> 16 & 255; pixels.data[i + 3] = 255; }
      context.putImageData(pixels, 0, 0);
      const original = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .95));
      const files = [new File([original], "synthetic-phone-photo.jpg", { type: "image/jpeg" })];
      const optimized = await prepare(files), dimensions = await createImageBitmap(optimized[0]);
      const form = new FormData(); form.set("reservationId", "synthetic-not-sent"); form.set("kind", "decoration"); for (const image of optimized) form.append("files", image);
      const requestBytes = (await new Response(form).arrayBuffer()).byteLength;
      const errors = [];
      try { await prepare([new File(["invalid"], "invalid.jpg", { type: "image/jpeg" })]); } catch (error) { errors.push(error.message); }
      try { await prepare(Array.from({ length: 11 }, () => files[0])); } catch (error) { errors.push(error.message); }
      const report = { sourceBytes: original.size, optimizedBytes: optimized[0].size, mime: optimized[0].type, width: dimensions.width, height: dimensions.height, requestBytes, rejectedInvalid: errors.length === 2, filename: optimized[0].name };
      dimensions.close(); canvas.width = 1; canvas.height = 1; return report;
    }, [
      ["@/lib/operational-proof", compile("src/lib/operational-proof.ts")],
      ["@/lib/operational-proof-upload-limits", compile("src/lib/operational-proof-upload-limits.ts")],
      ["client", compile("src/lib/operational-proof-upload-client.ts")],
    ]);
    assert.ok(result.sourceBytes > 4.5 * 1024 * 1024, "the source reproduces a phone image too large for a hosted Function request");
    assert.ok(result.optimizedBytes <= 600 * 1024); assert.ok(result.requestBytes < 3.6 * 1024 * 1024);
    assert.equal(result.mime, "image/jpeg"); assert.ok(result.width <= 2048 && result.height <= 2048); assert.equal(result.rejectedInvalid, true);
    console.log(JSON.stringify({ ok: true, groups: 3, scope: "real mobile Chromium canvas optimization, multipart budget and invalid-image feedback", ...result }));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
