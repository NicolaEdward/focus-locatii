const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function atLeast(actual, minimum) {
  const a = actual.split(".").map(Number), b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; }
  return true;
}
const minimums = { next: "15.5.28", sharp: "0.35.5", postcss: "8.5.23", mysql2: "3.23.1", nanoid: "3.3.18", "source-map-js": "1.2.2", "deepmerge-ts": "8.0.0", zod: "4.6.6" };
const args = ["list", "--prod", "--depth", "Infinity", "--json"];
const raw = process.env.npm_execpath
  ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  : execFileSync("pnpm", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const roots = JSON.parse(raw), components = new Map();
function visit(dependencies = {}) {
  for (const [name, value] of Object.entries(dependencies)) {
    if (!value || !value.version || !/^\d+\.\d+\.\d+$/.test(value.version)) continue;
    components.set(`${name}@${value.version}`, { type: "library", name, version: value.version, purl: `pkg:npm/${name.replace(/^@/, "%40")}@${value.version}` });
    if (minimums[name]) assert.ok(atLeast(value.version, minimums[name]), `${name}@${value.version} is below the reviewed security minimum ${minimums[name]}`);
    visit(value.dependencies);visit(value.optionalDependencies);
  }
}
for (const root of roots) { visit(root.dependencies);visit(root.optionalDependencies); }
for (const name of ["next", "mysql2", "zod", "sharp", "xlsx"]) assert.ok([...components.values()].some((c) => c.name === name), `missing expected production package ${name}`);
assert.ok(components.has("xlsx@0.20.3"), "the reviewed vendored spreadsheet parser must be present in the SBOM");
const out = path.join(process.cwd(), "artifacts", "security");fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "dependency-sbom.json"), JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, metadata: { timestamp: new Date().toISOString(), properties: [{ name: "pnpm-lock-sha256", value: crypto.createHash("sha256").update(fs.readFileSync("pnpm-lock.yaml")).digest("hex") }] }, components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));
console.log(`Dependency policy passed; ${components.size} production components recorded. Run pnpm audit --prod --audit-level high for current registry advisories.`);
