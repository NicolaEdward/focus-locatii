const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
// Use the same automatic JSX runtime as the application rather than tsx's
// preserve-mode fallback, which expects a global React namespace.
const source = fs.readFileSync(path.join(process.cwd(), "src/components/admin/inventory/OccupancySummary.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require, Intl, Date, Number }, { filename: "OccupancySummary.tsx" });
const { OccupancySummary } = loaded.exports;

const inventory = {
  asOf: "2026-11-13T23:30:00.000Z", dateKey: "2026-11-14", timeZone: "Europe/Bucharest",
  activeLocations: 6, staticLocations: 5, digitalLocations: 1, maintenanceLocations: 2,
  freeToday: 3, occupiedToday: 2, heldToday: 0, blockedToday: 0, unknownToday: 0
};
// This is a seller's one-row page, with several future records for locations
// that remain available today. It cannot be the source of global free counts.
const summary = { occupiedNow: 1, activeHolds: 1, upcoming: 12, activeOrUpcoming: 14, inventory };
const render = (props) => renderToStaticMarkup(React.createElement(OccupancySummary, props));
const complete = render({ summary });
assert.ok(complete.includes('aria-label="Libere azi: 3"'));
assert.ok(complete.includes('aria-label="Ocupate azi: 2"'));
assert.ok(complete.includes('aria-label="Locații OOH active: 5"'));
assert.ok(complete.includes('Rezervări viitoare în listă: <strong>12</strong>'));
assert.ok(!complete.includes("Total blocante"));
assert.ok(complete.includes("Inventar global"));
assert.ok(complete.includes("14.11.2026, ora 01:30 (București)"), "Snapshot display uses the company timezone, not the machine timezone");
assert.ok(complete.includes("Locații digitale excluse din OOH: <strong>1</strong>"));

const unknown = render({ summary: { ...summary, inventory: null } });
assert.ok(unknown.includes('aria-label="Libere azi: neverificat"'));
assert.ok(unknown.includes("lipsa informațiilor nu înseamnă zero"));
assert.ok(!unknown.includes('aria-label="Libere azi: 0"'));
assert.ok(!unknown.includes("Rezervări viitoare în listă"), "Missing inventory must not turn fallback row counts into verified facts");
const loading = render({ summary: null, loading: true });
assert.ok(loading.includes('aria-busy="true"'));
assert.ok(loading.includes("Se verifică disponibilitatea"));
assert.ok(!loading.includes('aria-label="Libere azi: 0"'));
const stale = render({ summary, error: "A read failed" });
assert.ok(stale.includes('aria-label="Libere azi: 3"'));
assert.ok(stale.includes("ultimele date verificate"));

const emptyInventory = Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, typeof value === "number" ? 0 : value]));
const verifiedEmpty = render({ summary: { ...summary, inventory: emptyInventory } });
assert.ok(verifiedEmpty.includes('aria-label="Libere azi: 0"'));
assert.ok(!verifiedEmpty.includes("nu este verificată"));
assert.ok(!verifiedEmpty.includes("Locații digitale excluse"), "Do not promote digital tools when none are present");
for (const invalid of [
  { ...inventory, freeToday: -1 },
  { ...inventory, freeToday: Number.NaN },
  { ...inventory, staticLocations: 99 },
  { ...inventory, activeLocations: 99 },
  { ...inventory, dateKey: "2026-99-99" },
  { ...inventory, asOf: "not a date" }
]) assert.ok(render({ summary: { ...summary, inventory: invalid } }).includes('aria-label="Libere azi: neverificat"'), "Malformed success payloads must not render authoritative counts");

console.log("Occupancy UI rendering passed: distinct global counts, future records, zero versus unknown/loading/error, Bucharest snapshot and malformed response protection");
