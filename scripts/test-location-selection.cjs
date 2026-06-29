const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const files = {
  page: read("src", "app", "admin", "selectie-locatii", "page.tsx"),
  api: read("src", "app", "api", "admin", "location-selection", "route.ts"),
  availabilityApi: read("src", "app", "api", "admin", "location-selection", "availability", "route.ts"),
  service: read("src", "lib", "location-selection.ts"),
  availability: read("src", "lib", "location-selection-availability.ts"),
  dto: read("src", "lib", "location-selection-dto.ts"),
  builder: read("src", "components", "admin", "location-selection", "AdminLocationSelectionPage.tsx"),
  results: read("src", "components", "admin", "location-selection", "LocationSelectionResults.tsx"),
  basket: read("src", "components", "admin", "location-selection", "LocationSelectionBasket.tsx"),
  map: read("src", "components", "admin", "location-selection", "LocationSelectionMap.tsx"),
  header: read("src", "components", "admin", "AdminHeader.tsx"),
  adminRoutes: read("src", "lib", "admin-routes.ts"),
  publicCard: read("src", "components", "public", "LocationCard.tsx"),
  publicDrawer: read("src", "components", "public", "ShortlistDrawer.tsx")
};

assert(files.page.includes('redirect("/admin/login")'), "selector route must redirect unauthenticated users to login");
assert(files.page.includes('hasPermission(session.role, "inventory.view")'), "selector route must require inventory.view");
assert(files.api.includes('requirePermission(request, "inventory.view")'), "selector list API must require inventory.view");
assert(files.availabilityApi.includes('requirePermission(request, "inventory.view")'), "bulk availability API must require inventory.view");
assert(files.availabilityApi.includes("locationIds") && files.availabilityApi.includes("max(500)"), "bulk availability API should accept bounded locationIds");

for (const status of ["HOLD", "RESERVED", "BOOKED"]) {
  assert(files.availability.includes(status), `availability must treat ${status} as blocking`);
}
for (const status of ["CANCELLED", "EXPIRED", "LOST", "ARCHIVED"]) {
  assert(files.availability.includes(status), `availability must document ${status} as non-blocking`);
}
assert(files.availability.includes("periodStart: { lte: periodEnd }"), "availability must use inclusive overlap start check");
assert(files.availability.includes("periodEnd: { gte: periodStart }"), "availability must use inclusive overlap end check");

for (const forbidden of [
  "latReal",
  "lngReal",
  "internalNotes",
  "monthlyCost",
  "costSupplier",
  "costNotes",
  "productionNotes",
  "documents",
  "SmartBill",
  "reservations:"
]) {
  assert(!files.dto.includes(forbidden), `selector DTO must not expose ${forbidden}`);
}

assert(files.service.includes("buildMediaPlanSeedFromSelection"), "future Media Plan seed helper must exist");
assert(files.service.includes('source: "ADMIN_LOCATION_SELECTOR"'), "seed helper must label source");
assert(!/prisma\.(mediaPlan|offer|reservation)\.(create|update|upsert)/.test(files.service), "selector service must not create media plans, offers or reservations");
assert(!files.builder.includes("/api/reservations"), "selector UI must not call reservation write APIs");
assert(files.builder.includes("localStorage"), "active selection should be client-side persisted");
assert(files.builder.includes("Selecteaza rezultate vizibile"), "bulk select visible action should exist");
assert(files.builder.includes("Adaugi ${candidates.length} locatii vizibile"), "bulk selecting more than 25 should ask for confirmation");
assert(files.basket.includes("Continua catre Media Plan - urmatorul pas"), "future Media Plan CTA should be disabled placeholder");
assert(files.basket.includes("disabled"), "future Media Plan CTA must not write in this batch");

assert(files.results.includes("Adauga") && files.results.includes("Scoate"), "result rows need add/remove actions");
assert(files.map.includes("scrollWheelZoom: false"), "selector map should not hijack page scroll");
assert(files.map.includes("displayLat") && files.map.includes("displayLng"), "selector map must use display coordinates");
assert(!files.map.includes("latReal") && !files.map.includes("lngReal"), "selector map must not use private coordinates");
assert(files.header.includes("/admin/selectie-locatii"), "admin header must link to selector");
assert(files.adminRoutes.includes("adminLocationSelectorHref"), "admin route helper must include selector href");

assert(files.publicCard.includes("Adauga in selectie") || files.publicCard.includes("Adaugă în selecție"), "public card must keep selection wording");
assert(files.publicDrawer.includes("Selectia ta de locatii") || files.publicDrawer.includes("Selecția ta de locații"), "public drawer must keep selection wording");

console.log("Location selector source checks passed.");
