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
  const reservationLocationsRoute = read("src", "app", "api", "admin", "reservation-locations", "route.ts");
  const lifecycleDomain = read("src", "lib", "reservation-lifecycle-domain.ts");
  const occupancySummary = read("src", "components", "admin", "inventory", "OccupancySummary.tsx");
  const operationalPage = read("src", "app", "admin", "operational", "page.tsx");
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const overrideControls = read("src", "components", "admin", "inventory", "LocationAvailabilityControls.tsx");
  const reservationWorkspace = read("src", "components", "admin", "AdminReservationsPanel.tsx");

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
  assert(lazyWorkspace.includes('view=workspace'), "lazy workspace should use the minimal reservation workspace DTO");
  assert(lazyWorkspace.includes("void loadAdminReservationsPanel()"), "workspace code and data should preload in parallel");
  assert(lazyWorkspace.includes("/api/admin/reservation-locations"), "workspace must use the compact reservation location DTO");
  assert(lazyWorkspace.includes("request.action && request.reservationId"), "direct HOLD actions must load only the selected reservation");
  assert(lazyWorkspace.includes("locationId="), "direct HOLD actions must load only the selected location");
  assert(lazyWorkspace.includes("focusedReservationId={request.reservationId}"), "direct HOLD actions must pass focus without depending on URL timing");

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
  assert(reservationLocationsRoute.includes('requirePermission(request, "inventory.view")'), "reservation location options must enforce RBAC");
  assert(reservationRoute.includes('requireAnyPermission(request, ["reservations.view", "reservations.view.own"])'), "reservation list API must enforce RBAC");
  assert(reservations.includes('value="HOLD_ACTIVE"'), "technical HOLD/RESERVED statuses must have one business filter");
  assert(reservations.includes('aria-label="Filtreaza rezervarile dupa status"'), "reservation status filter must have an accessible label");
  assert(reservations.includes("Editeaza HOLD"), "active HOLD rows must expose a direct edit action");
  assert(reservations.includes("Anuleaza HOLD"), "active HOLD rows must expose a direct cancellation action");
  assert(inventory.includes('aria-label="Filtreaza inventarul dupa categorie"'), "inventory category filter must have an accessible label");
  assert(inventory.includes('aria-label="Filtreaza inventarul dupa stare"'), "inventory lifecycle filter must have an accessible label");
  assert(reservationWorkspace.includes('id="rezervari-workspace"'), "lazy reservation workspace must use a unique anchor id");
  assert(!reservationWorkspace.includes('id="rezervari"'), "lazy reservation workspace must not duplicate the main reservations anchor");
  assert(reservationWorkspace.includes('aria-label="Filtreaza solicitarile dupa status"'), "offer request status filter must have an accessible label");
  assert(reservationWorkspace.includes('aria-label="Filtreaza solicitarile dupa responsabil"'), "offer request owner filter must have an accessible label");
  assert(reservationWorkspace.includes('aria-label="Numele vanzatorului pentru alocare"'), "offer request assignment input must have an accessible label");
  assert(lifecycleDomain.includes('BOOKED: "Rezervat"'), "BOOKED must be displayed as Rezervat");
  assert(lifecycleDomain.includes('RESERVED: "HOLD"'), "RESERVED must be displayed as HOLD");
  assert(lifecycleDomain.includes("activeOrUpcoming: input.occupiedNow + input.activeHolds + input.upcoming"), "occupancy total must reconcile from mutually exclusive cards");
  assert(reservationsService.includes('{ status: "BOOKED", periodStart: { gt: today }'), "future reservation count must exclude HOLD rows already shown separately");
  assert(occupancySummary.includes('"Rezervari viitoare"') && occupancySummary.includes('"Total blocante"'), "occupancy labels must explain the reconciled categories");
  assert(lazyWorkspace.includes("initialOccupancySummary"), "workspace must receive the canonical occupancy summary");
  assert(read("src", "app", "api", "reservations", "route.ts").includes('view === "occupancy-summary"'), "mutations must refresh a compact occupancy summary");

  assert(operationalPage.includes("AdminReservationsPanel"), "operational workflows must remain in the operational module");
  assert(!editor.includes('label="Motiv blocare"'), "legacy scalar block editor must not remain as a second write UI");
  assert(overrideControls.includes("Marcheaza indisponibila"), "canonical override control must remain available");
  assert(overrideControls.includes("/block"), "canonical override control must use the shared compatibility route");
  assert(overrideControls.includes("Mentenanta") && overrideControls.includes("lifecycleStatus"), "inventory drawer must expose the canonical lifecycle state");
  assert(overrideControls.includes("Elimina blocajul comercial"), "commercial unblock must not pretend to reactivate lifecycle state");

  assert(reservationsService.includes("assertCanonicalReservationAvailabilityForWrite"), "reservation writes must keep the canonical conflict service");
  assert(reservationsService.includes("lockReservationLocationsForWrite"), "reservation writes must keep the row lock");
  assert(reservationWorkspace.includes("const preview = currentPeriodPreview || await runPeriodPreview()"), "period edits must validate availability automatically when saving");
  assert(!reservationWorkspace.includes("mustPreviewPeriod && (!currentPeriodPreview"), "a missing manual preview must not disable period save");
  assert(reservationWorkspace.includes('"Verifica si salveaza"'), "period save action must explain the automatic validation");
  assert(reservationsService.includes("reservationUpdateTransactionOptions"), "reservation edits must tolerate normal database latency");
  assert(reservationsService.includes("resolveRentalContextForUpdate(parsed, existing, tx)"), "single edits must validate rental context inside the write transaction");
  assert(reservationsService.includes("rentalContextCache"), "group edits must not reload the same client and campaign for every location");
  assert(reservationsService.includes("splitDecorationCostForGroup"), "group writes must divide the decoration total server-side");
  assert(reservationWorkspace.includes("editingGroupReservations"), "the editor must load the complete group before calculating totals");
  assert(read("src", "app", "api", "reservations", "[id]", "route.ts").includes("getReservationGroup"), "reservation detail must return the complete contract group");

  console.log(JSON.stringify({ ok: true, checked: 47 }, null, 2));
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
