const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  adminLocationTableIsScanFirst();
  rowDangerousActionsAreInMenu();
  locationEditorHasPracticalSections();
  publicImpactFieldsHaveWarning();
  manualAvailabilityActionsAreClear();
  costFieldsAreClarified();
  privateFieldsStayOutOfOverview();
  galleryPreviewIsPresent();
  productionSketchSupportUsesExistingImages();
  operationalWidgetsMovedToWorkspace();
  locationWorkspaceLoadsSummaryDataFirst();
  salesExportsBelongToFinance();
  activeRentalsCanBeCorrectedSafely();
  numericBlankValuesRemainNull();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "locations table is scan-first, without inline row editing",
      "delete and duplicate are only inside action menu with confirmations",
      "locations page focuses primary actions and demotes inventory tools",
      "availability export is not exposed on /admin/locatii",
      "LocationEditor contains practical section labels",
      "public-impact fields include a warning",
      "manual availability block actions are explicit",
      "cost fields are clarified as supplier/financial context",
      "raw/private fields are not in Overview",
      "gallery preview and empty state exist",
      "production sketch is edited separately from public gallery",
      "operational widgets moved to /admin/operational",
      "locations workspace avoids duplicate operational data and lazy-loads reservation details",
      "sales export removed from /admin/locatii and kept under finance",
      "active rental correction keeps client/campaign and cancellation safe",
      "blank numeric values remain null"
    ]
  }, null, 2));
}

function adminLocationTableIsScanFirst() {
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const inventory = read("src", "components", "admin", "inventory", "InventoryList.tsx");
  assert(dashboard.includes('<section id="locatii"'), "locations page should expose a dedicated inventory section anchor");
  const tableBlock = blockFrom(inventory, "<table", "</table>");
  assert(tableBlock.includes("<Th>Vizibilitate</Th>"), "table should show public/admin visibility summary");
  assert(tableBlock.includes("<Th>Status calculat</Th>"), "table should show computed availability/status label");
  assert(!tableBlock.includes("<Th>GPS</Th>"), "raw GPS column should be removed from first table view");
  assert(!tableBlock.includes("quickPatch("), "table should not perform inline row PATCH edits");
  assert(!tableBlock.includes("<select"), "table should not render inline status editors");
  assert(!tableBlock.includes("defaultValue={location.rateCard"), "table should not render inline rate card editors");
  assert(!tableBlock.includes("latReal?.toFixed"), "real/private coordinates should not render in first table view");
  assert(!inventory.includes("ToggleMini"), "public toggles should not be direct row controls");
  assert(dashboard.includes("Rezervari si HOLD-uri"), "locations page should foreground reservations and holds");
  assert(dashboard.includes("Inventar locatii"), "locations page should have a dedicated inventory section");
  assert(dashboard.includes("Selector oferta"), "locations page should cross-link to the sales selector");
  assert(dashboard.includes("Export inventar JSON"), "developer-ish Backup JSON label should remain renamed");
  assert(dashboard.includes("Import / actualizare"), "inventory import should remain available as a secondary tool");
  assert(dashboard.includes("Audit GPS"), "GPS audit should remain available as a secondary tool");
  assert(!dashboard.includes("Exporta disponibil"), "availability export should move out of /admin/locatii");
  assert(!dashboard.includes("Exporta situatie vanzari"), "sales export should not be exposed on /admin/locatii");

  const reservationsPanel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  assert(!reservationsPanel.includes("Disponibil pentru vanzari"), "availability export card should not remain in locations reservations panel");
  assert(!reservationsPanel.includes("Exporta disponibil"), "availability export action should not remain in locations reservations panel");
  assert(!reservationsPanel.includes("Exporta situatie vanzari"), "sales export action should not remain in locations reservations panel");
}

function rowDangerousActionsAreInMenu() {
  const inventory = read("src", "components", "admin", "inventory", "InventoryList.tsx");
  assert(inventory.includes("onDuplicate={() => duplicate(location)}"), "duplicate should be routed through action menu");
  assert(inventory.includes("onDelete={() => remove(location)}"), "delete should be routed through action menu");
  assert(!inventory.includes('title="Duplicate"'), "duplicate should not be a first-level icon button");
  assert(!inventory.includes('title="Delete"'), "delete should not be a first-level icon button");
  assert(inventory.includes("Duplici locatia ${label}?"), "duplicate must require contextual confirmation");
  assert(inventory.includes("Stergi locatia ${label}?"), "delete must require contextual confirmation");
  assert(inventory.includes("Se va crea o copie ascunsa din portalul public"), "duplicate confirmation should explain the copy behavior");
}

function locationEditorHasPracticalSections() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  for (const title of [
    "Overview",
    "Comercial",
    "Disponibilitate",
    "Galerie / Poze",
    "Operational",
    "Financiar",
    "Documente / Istoric",
    "Setari avansate"
  ]) {
    assert(editor.includes(`EditorSection title="${title}"`), `LocationEditor should include ${title} section`);
  }
}

function publicImpactFieldsHaveWarning() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  assert(editor.includes("function PublicImpactNotice"), "public-impact warning component should exist");
  assert(editor.includes("Aceasta schimbare afecteaza portalul public"), "public-impact warning text should be visible");
  for (const field of ["showPricePublic", "showInstallationCostPublic", "showInPublic", "latDisplay", "lngDisplay"]) {
    assert(editor.includes(field), `${field} should remain editable in the appropriate section`);
  }
}

function manualAvailabilityActionsAreClear() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const controls = read("src", "components", "admin", "inventory", "LocationAvailabilityControls.tsx");
  assert(editor.includes("controlul canonic dedicat"), "editor should point users to the canonical availability control");
  assert(!editor.includes('label="Motiv blocare"'), "editor should not expose a second legacy scalar block UI");
  assert(controls.includes("Marcheaza indisponibila"), "detail view should expose a clear manual unavailable action");
  assert(controls.includes("Elimina blocajul comercial"), "detail view should expose a clear unblock action without changing lifecycle");
  assert(controls.includes("Mentenanta") && controls.includes("lifecycleStatus"), "detail view should expose the canonical inventory lifecycle separately");
  assert(controls.includes("singurul control pentru blocajul comercial"), "manual unavailable action should use one canonical control");
}

function costFieldsAreClarified() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  assert(editor.includes("Cost furnizor / chirie locatie"), "supplier/rent cost label should be clear");
  assert(editor.includes("Tip cost / acord"), "cost type label should describe agreement context");
  assert(editor.includes("Furnizor / proprietar cost"), "cost supplier label should describe owner/supplier context");
  assert(editor.includes("Note costuri / context financiar"), "cost notes label should explain financial context");
  assert(editor.includes("chiria trebuie legata de acordul cu furnizorul"), "editor should document future supplier cost architecture");
}

function privateFieldsStayOutOfOverview() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const overview = blockFrom(editor, 'EditorSection title="Overview"', "</EditorSection>");
  for (const privateField of ["latReal", "lngReal", "internalNotes", "monthlyCost", "costNotes", "blockedReason"]) {
    assert(!overview.includes(privateField), `${privateField} should not appear in Overview`);
  }

  const advanced = blockFrom(editor, 'EditorSection title="Setari avansate"', "</EditorSection>");
  assert(advanced.includes('label="latReal"'), "latReal should be moved to advanced settings");
  assert(advanced.includes('label="lngReal"'), "lngReal should be moved to advanced settings");
}

function galleryPreviewIsPresent() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  assert(editor.includes("function GalleryPreview"), "gallery preview helper should exist");
  assert(editor.includes("Nu exista poze pentru aceasta locatie."), "gallery should show an empty state");
  assert(editor.includes("Principala / prima poza"), "gallery should identify the main/first image");
}

function productionSketchSupportUsesExistingImages() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const mutations = read("src", "lib", "location-mutations.ts");
  const locations = read("src", "lib", "locations.ts");
  const presentation = read("src", "components", "public", "LocationPresentation.tsx");
  const availabilityExport = read("src", "app", "api", "admin", "availability", "excel", "route.ts");
  assert(editor.includes("Schita de productie URL"), "LocationEditor should expose production sketch URL editing");
  assert(mutations.includes("PRODUCTION_SKETCH_ALT"), "sketch should reuse existing image rows without a migration");
  assert(mutations.includes("NOT: { alt: PRODUCTION_SKETCH_ALT }"), "gallery sync should preserve sketch image rows");
  assert(locations.includes("productionSketchUrl"), "location serializer should expose an explicit sketch URL");
  assert(presentation.includes("Descarca schita"), "public presentation should show sketch download when available");
  assert(availabilityExport.includes('"Schita"'), "availability export should include a Schita column");
}

function operationalWidgetsMovedToWorkspace() {
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const operationalPage = read("src", "app", "admin", "operational", "page.tsx");
  const routes = read("src", "lib", "admin-routes.ts");
  const header = read("src", "components", "admin", "AdminHeader.tsx");
  assert(!dashboard.includes("Active, urmatoare si operationale"), "locations page copy should not mix operational widgets into /admin/locatii");
  assert(panel.includes('workspace = "locations"'), "reservations panel should default to locations workspace");
  assert(panel.includes('workspace === "operational"'), "reservations panel should have an operational workspace mode");
  assert(panel.includes("panelAllowedInWorkspace"), "operational panels should be gated by workspace");
  assert(operationalPage.includes('workspace="operational"'), "/admin/operational should render operational widgets");
  assert(routes.includes('adminHref("/admin/operational"'), "operational route helper should point to the operational workspace");
  assert(header.includes('href="/admin/operational"'), "admin navigation should include Operational");
}

function locationWorkspaceLoadsSummaryDataFirst() {
  const page = read("src", "app", "admin", "locatii", "page.tsx");
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const lazyWorkspace = read("src", "components", "admin", "inventory", "LazyReservationWorkspace.tsx");
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const reservations = read("src", "lib", "reservations.ts");
  const locations = read("src", "lib", "locations.ts");
  const detailRoute = read("src", "app", "api", "reservations", "[id]", "route.ts");
  assert(page.includes("listAdminLocationPage"), "locations page should load a bounded inventory page");
  assert(page.includes("listReservationPage"), "locations page should load a bounded reservation page");
  assert(!page.includes("listAdminLocations("), "locations page should not load the complete inventory");
  assert(!page.includes("listReservations("), "locations page should not load the complete reservation registry");
  assert(!page.includes("listOperationReservations"), "locations page must not load the operational reservation dataset twice");
  assert(!dashboard.includes("operationReservations="), "locations dashboard should not serialize operational history into the page");
  assert(panel.includes('fetch(`/api/reservations/${summary.id}`'), "reservation detail should load only when edit is opened");
  assert(lazyWorkspace.includes("dynamic("), "complete reservation workspace should load only on demand");
  assert(reservations.includes("reservationSummaryInclude"), "reservation summary query should use a narrow relation set");
  assert(locations.includes("effectiveBlockingReservationWhere"), "location summaries must use the canonical effective reservation rule");
  assert(!locations.includes("await expireStaleHolds()"), "location summaries must ignore expired holds without relying on a write during page load");
  assert(detailRoute.includes("getReservationGroup(id, session)"), "reservation detail route should enforce authenticated ownership for the requested reservation group");
}

function salesExportsBelongToFinance() {
  const header = read("src", "components", "admin", "AdminHeader.tsx");
  const cooCommandCenter = read("src", "components", "admin", "CooCommandCenter.tsx");
  const salesExportButton = read("src", "components", "admin", "SalesReportExportButton.tsx");
  const salesReport = read("src", "app", "api", "admin", "sales-report", "excel", "route.ts");
  assert(header.includes('label="Export vanzari"'), "sales export should remain available under finance navigation");
  assert(header.includes("SalesReportExportButton"), "finance navigation should ask for a period before exporting sales");
  assert(!header.includes('href="/api/admin/sales-report/excel"'), "finance navigation should not download the default sales export directly");
  assert(!cooCommandCenter.includes("SalesReportExportButton"), "COO command center should delegate sales exports to the finance workflow");
  assert(salesExportButton.includes('type="date"'), "sales export dialog should collect a date range");
  assert(salesExportButton.includes("new URLSearchParams({ from, to })"), "sales export should send selected from/to parameters");
  assert(salesExportButton.includes("Data de final trebuie sa fie dupa data de inceput."), "sales export dialog should validate date order");
  assert(salesReport.includes("sortSalesRows"), "sales export should have deterministic business sorting");
  assert(salesReport.includes("salesRowTimingRank"), "sales export should group active/upcoming/past rows");
  assert(!salesReport.includes("listAdminLocations"), "sales export must not depend on the lightweight inventory DTO that omits reservation details");
  assert(salesReport.includes("prisma.location.findMany"), "sales export should load its report dataset directly");
  assert(salesReport.includes('status: "BOOKED"'), "sales export should include confirmed rentals");
  assert(salesReport.includes("periodStart: { lte: periodEnd }"), "sales export should include rentals that start before the selected range ends");
  assert(salesReport.includes("periodEnd: { gte: periodStart }"), "sales export should include rentals that end after the selected range starts");
}

function activeRentalsCanBeCorrectedSafely() {
  const panel = read("src", "components", "admin", "AdminReservationsPanel.tsx");
  const reservations = read("src", "lib", "reservations.ts");
  assert(panel.includes("clientId: reservation.clientId ||"), "edit dialog should start from the current booked client id");
  assert(panel.includes("campaignId: reservation.campaignId ||"), "edit dialog should start from the current booked campaign id");
  assert(panel.includes("clientId: editForm.clientId"), "reservation edit save should send the corrected client id");
  assert(panel.includes("campaignId: editForm.campaignId"), "reservation edit save should send the corrected campaign id");
  assert(panel.includes("Corectare client / campanie"), "booked rentals should expose a clear client/campaign correction area");
  assert(panel.includes("Foloseste asta"), "client/campaign correction should explain when to use it");
  assert(panel.includes("function ReservationCancellationConfirmDialog"), "cancel action should require a structured cancellation decision");
  assert(panel.includes("onConfirm({ applyToGroup, reason: trimmedReason })"), "cancel dialog should send structured cancellation scope and reason");
  assert(panel.includes("Motiv obligatoriu"), "cancel action should require a cancellation reason");
  assert(panel.includes("Doar locatia curenta"), "edit dialog should clearly support single-location corrections");
  assert(panel.includes("Tot contractul grupat"), "edit dialog should clearly support grouped corrections");
  assert(panel.includes("Impact comercial estimat"), "edit dialog should preview the commercial impact before saving");
  assert(panel.includes("Istoric corectii"), "edit dialog should show visible correction history");
  assert(panel.includes("Atentie financiar"), "edit dialog should warn when billing records are attached");
  assert(panel.includes("Inchirieri active"), "locations workflow should expose active rentals separately from monthly sales");
  assert(panel.includes("cancellationReason"), "cancel action should send the reason to the API");
  assert(panel.includes("locatia devine disponibila"), "cancel confirmation should explain that availability is released");
  assert(reservations.includes("rental_correction"), "backend should store a visible rental correction log");
  assert(reservations.includes("billingSummary"), "backend should expose a safe billing summary for admin warnings");
  assert(reservations.includes("resolveRentalContextForUpdate"), "backend should keep real client/campaign context as source of truth on booked updates");
}

function numericBlankValuesRemainNull() {
  const editor = read("src", "components", "admin", "LocationEditor.tsx");
  const numberOrNull = blockFrom(editor, "function numberOrNull", "function dateOrNull");
  assert(numberOrNull.includes("if (!value.trim()) return null;"), "blank optional numeric inputs must not be saved as 0");
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
