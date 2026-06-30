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
  filters: read("src", "components", "admin", "location-selection", "LocationSelectionFilters.tsx"),
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
assert(files.availability.includes("buildNoPeriodAvailability"), "availability must provide useful no-period status");
assert(files.availability.includes("Disponibil pana la"), "no-period future booking should show available-until label");
assert(files.availability.includes("Disponibil din"), "current booking should show available-from label");
assert(files.availability.includes("label: \"Indisponibil\""), "selected-period conflicts must be labelled unavailable");
assert(files.availability.includes("Ocupat in perioada"), "selected-period conflicts must explain occupied period");
assert(files.availability.includes("Disponibil in perioada selectata"), "selected-period available state must be unambiguous");
assert(files.availability.includes("selectedPeriodCoverage"), "selected-period availability must calculate partial coverage");
assert(files.availability.includes('state: "PARTIAL"'), "selected-period partial overlaps must be marked as partial, not full conflict");
assert(files.availability.includes("Disponibil partial"), "selected-period partial availability must have a clear label");
assert(files.availability.includes("availableFrom: firstAvailable.start.toISOString()"), "partial availability should expose the first available start date");
assert(files.availability.includes("availableUntil: firstAvailable.end.toISOString()"), "partial availability should expose the first available end date");
assert(files.availability.includes("isGenericAvailableNote"), "generic available notes must be suppressed when they contradict conflicts");
assert(files.dto.includes("tone: LocationSelectionAvailabilityTone"), "availability DTO must include tone");
assert(files.dto.includes("explanation: string"), "availability DTO must include explanation");
assert(files.dto.includes("blockingIntervals"), "availability DTO must expose safe blocking intervals");

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
assert(files.builder.includes("availabilityRequestRef"), "availability requests must guard stale responses");
assert(files.builder.includes("AbortController"), "availability requests must be abortable");
assert(files.builder.includes("allAvailabilityIdsKey"), "availability requests must use stable location id keys");
assert(!files.builder.includes("[filteredLocations, selection.items, selection.periodEnd, selection.periodStart]"), "availability effect must not depend on availability-derived filtered rows");
assert(files.builder.includes("const [showMap, setShowMap] = useState(false)"), "map should be collapsed by default");
assert(!files.builder.includes("Firma contractanta"), "selector must not expose legal company selection");
assert(files.builder.includes('companyEntity: "Focus Media"'), "selector may keep a safe internal company context for compatibility");
assert(files.builder.includes("locationMatchesAvailabilityFilter"), "selector must use one availability filter model");
assert(files.builder.includes('availability: "PROPOSABLE"'), "selected-period default should focus on proposable locations");
assert(files.builder.includes("state === \"AVAILABLE\" || state === \"PARTIAL\""), "default selected-period filter should hide fully conflicted locations");
assert(files.builder.includes("availabilityById[location.id]?.state !== \"CONFLICT\""), "bulk select must not select hidden or conflicted locations");
assert(files.builder.includes("Selecteaza tot"), "bulk select action should be sales-friendly");
assert(files.builder.includes("Vrei sa selectezi ${candidates.length} locatii?"), "bulk selecting more than 25 should ask for confirmation");
assert(files.builder.includes("buildAvailabilityExportHref"), "selector should build an availability export URL");
assert(files.filters.includes("Disponibile / partiale"), "availability filter should support default proposable locations");
assert(files.filters.includes("Disponibile partial"), "availability filter should support partial availability");
assert(files.filters.includes("Indisponibile / cu conflict"), "availability filter should expose conflicts only explicitly");
assert(!files.filters.includes("Suprafata min."), "surface min filter should not be primary");
assert(!files.filters.includes("Suprafata max."), "surface max filter should not be primary");
assert(!files.filters.includes("Pret min."), "price min filter should not be primary");
assert(!files.filters.includes("Pret max."), "price max filter should not be primary");
assert(!files.filters.includes("Select label=\"Zona\""), "zone filter should not be primary");
assert(files.basket.includes("Continua catre Media Plan - urmatorul pas"), "future Media Plan CTA should be disabled placeholder");
assert(files.basket.includes("disabled"), "future Media Plan CTA must not write in this batch");
assert(files.basket.includes("Exporta disponibil"), "basket should expose availability export as a primary action");
assert(files.basket.includes("Mai multe") && files.basket.includes("Copiaza coduri selectate"), "copy codes should be secondary");

assert(files.results.includes("Adauga") && files.results.includes("Scoate"), "result rows need add/remove actions");
assert(files.results.includes("availability?.explanation"), "result rows must use normalized availability explanation");
assert(files.results.includes("w-[104px]"), "result action button should keep a stable visible width");
assert(files.results.includes("disabled={unavailable}"), "fully unavailable rows should not be addable by default");
assert(files.results.includes("blockingText"), "conflict rows should show safe blocking intervals when visible");
assert(files.map.includes("scrollWheelZoom: false"), "selector map should not hijack page scroll");
assert(files.map.includes("displayLat") && files.map.includes("displayLng"), "selector map must use display coordinates");
assert(!files.map.includes("latReal") && !files.map.includes("lngReal"), "selector map must not use private coordinates");
assert(files.header.includes("/admin/selectie-locatii"), "admin header must link to selector");
assert(files.adminRoutes.includes("adminLocationSelectorHref"), "admin route helper must include selector href");

assert(files.publicCard.includes("Adauga in selectie") || files.publicCard.includes("Adaugă în selecție"), "public card must keep selection wording");
assert(files.publicDrawer.includes("Selectia ta de locatii") || files.publicDrawer.includes("Selecția ta de locații"), "public drawer must keep selection wording");

console.log("Location selector source checks passed.");
