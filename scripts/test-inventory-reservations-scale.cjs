const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  const page = read("src", "app", "admin", "locatii", "page.tsx");
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const inventory = read("src", "components", "admin", "inventory", "InventoryList.tsx");
  const reservations = read("src", "components", "admin", "inventory", "ReservationList.tsx");
  const lazyWorkspace = read("src", "components", "admin", "inventory", "LazyReservationWorkspace.tsx");
  const locationsService = read("src", "lib", "locations.ts");
  const reservationsService = read("src", "lib", "reservations.ts");
  const locationRoute = read("src", "app", "api", "admin", "locations", "route.ts");
  const reservationRoute = read("src", "app", "api", "admin", "reservations", "route.ts");
  const operationalPage = read("src", "app", "admin", "operational", "page.tsx");
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const overrideControls = read("src", "components", "admin", "inventory", "LocationAvailabilityControls.tsx");

  assert(page.includes("listAdminLocationPage"), "initial inventory must use the paginated service");
  assert(page.includes("listReservationPage"), "initial occupancy must use the paginated reservation service");
  assert(!page.includes("listAdminLocations("), "initial page must not serialize the complete inventory");
  assert(!page.includes("listReservations("), "initial page must not serialize the complete reservation registry");
  assert(!page.includes("listOfferRequests"), "offer requests must not load on initial inventory render");

  assert(dashboard.includes("InventoryList"), "dashboard must compose the extracted inventory list");
  assert(dashboard.includes("ReservationList"), "dashboard must compose the extracted reservation list");
  assert(dashboard.includes("LazyReservationWorkspace"), "legacy reservation editor must remain available behind a lazy boundary");
  assert(!dashboard.includes('import { AdminReservationsPanel }'), "the 3951-line workspace must not enter the initial dashboard chunk");
  assert(lazyWorkspace.includes("dynamic("), "legacy reservation workspace must be code-split");
  assert(lazyWorkspace.includes('view=summary'), "lazy workspace should avoid nested reservation history until edit");

  assert(locationsService.includes("adminLocationSummarySelect"), "inventory list must have an explicit minimal select");
  assert(locationsService.includes("take: pageSize"), "inventory list must have a bounded page size");
  const locationSummary = blockFrom(locationsService, "function adminLocationSummarySelect", "function publicLocationInclude");
  assert(!locationSummary.includes("images:"), "inventory list must not load image galleries");
  assert(inventory.includes("/api/admin/locations"), "inventory filters must execute server-side");
  assert(inventory.includes("window.setTimeout"), "inventory search must be debounced");
  assert(inventory.includes("syncInventoryUrl"), "inventory filters must be reproducible from URL state");

  assert(reservationsService.includes("reservationListItemSelect"), "reservation list must use an explicit summary select");
  assert(reservationsService.includes("listReservationPage"), "reservation pagination service must exist");
  assert(reservations.includes("/api/admin/reservations"), "reservation filters must execute server-side");
  assert(reservations.includes('setScope("history")'), "history must load only after the user opens it");
  assert(!reservationRoute.includes("documents"), "reservation list route must not return operational proof metadata");
  assert(locationRoute.includes('requirePermission(request, "inventory.view")'), "inventory list API must enforce RBAC");
  assert(reservationRoute.includes('requireAnyPermission(request, ["reservations.view", "reservations.view.own"])'), "reservation list API must enforce RBAC");

  assert(operationalPage.includes("AdminReservationsPanel"), "operational workflows must remain in the operational module");
  assert(!editor.includes('label="Motiv blocare"'), "legacy scalar block editor must not remain as a second write UI");
  assert(overrideControls.includes("Marcheaza indisponibila"), "canonical override control must remain available");
  assert(overrideControls.includes("/block"), "canonical override control must use the shared compatibility route");

  assert(reservationsService.includes("assertCanonicalReservationAvailabilityForWrite"), "reservation writes must keep the canonical conflict service");
  assert(reservationsService.includes("lockReservationLocationsForWrite"), "reservation writes must keep the row lock");

  console.log(JSON.stringify({ ok: true, checked: 25 }, null, 2));
}

function blockFrom(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}
