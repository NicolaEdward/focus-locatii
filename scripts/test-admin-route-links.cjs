const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./load-ts-module.cjs");

const routes = loadTsModule(path.join(process.cwd(), "src/lib/admin-routes.ts"));

assert.equal(routes.adminReservationHref("res_123"), "/admin/locatii?reservationId=res_123#rezervari");
assert.equal(routes.adminReservationsHref(), "/admin/locatii#rezervari");
assert.equal(routes.adminNewReservationHref({ source: "crm" }), "/admin/locatii?source=crm&newReservation=1#rezervari");
assert.equal(routes.adminLocationHref("loc_123"), "/admin/locatii?locationId=loc_123#locatii");
assert.equal(routes.adminClientHref("client_123"), "/admin/clienti?clientId=client_123");
assert.equal(routes.adminCampaignHref("campaign_123"), "/admin/campanii?campaignId=campaign_123");
assert.equal(routes.adminOperationalHref(), "/admin/operational");

const dashboardActionFiles = [
  "src/components/admin/RoleDashboard.tsx",
  "src/components/admin/DashboardHoldActions.tsx",
  "src/components/admin/CooCommandCenter.tsx",
  "src/components/admin/CrmWorkspace.tsx"
];

for (const file of dashboardActionFiles) {
  const source = read(file);
  assert.equal(
    source.includes('"/admin/locatii#rezervari"') || source.includes("'/admin/locatii#rezervari'"),
    false,
    `${file} should use admin route helpers instead of hardcoded reservation anchor links.`
  );
}

const header = read("src/components/admin/AdminHeader.tsx");
assert.match(header, /usePathname/, "AdminHeader should derive active page state from the current pathname.");
assert.match(header, /aria-current=\{active \? "page" : undefined\}/, "Active admin nav item should expose aria-current.");
assert.match(header, /Portal public/, "Admin public link should use the clearer label.");
assert.match(header, /label="Comercial"/, "AdminHeader should group sales workflows under Comercial.");
assert(
  header.indexOf('label="Comercial"') < header.indexOf('href="/admin/selectie-locatii"'),
  "Selector oferta should live inside the Comercial workflow menu."
);
assert.match(header, /label="Financiar"/, "AdminHeader should group finance workflows under Financiar.");
assert(
  header.indexOf('label="Financiar"') < header.indexOf('href="/admin/furnizori"'),
  "Furnizori should live inside the Financiar workflow menu."
);
assert.match(header, /label="Setari"/, "AdminHeader should expose Setari instead of a vague Admin button.");
assert.match(header, /href="\/admin\/operational"/, "AdminHeader should expose a dedicated Operational workspace.");
assert.match(header, /session\.role === "FIELD_OPERATOR"/, "AdminHeader should treat field operators as a restricted navigation role.");
assert.match(header, /"dashboard\.operations\.view"/, "Operational navigation should include the dedicated operations dashboard permission.");
assert.equal(header.includes('<AdminNavLink href="/admin/campanii"'), false, "Campanii should not be a misleading top-level nav item.");
assert.equal(header.includes('<AdminNavLink href="/admin/furnizori"'), false, "Furnizori should not clutter top-level navigation.");
assert.equal(header.includes("/api/admin/availability/excel"), false, "Availability export should not be exposed from the global admin header.");

const adminDashboard = read("src/components/admin/AdminDashboard.tsx");
assert.equal(adminDashboard.includes("Backup JSON"), false, "Developer-ish Backup JSON label should not be visible.");
assert.match(adminDashboard, /locationId/, "Admin locations page should understand locationId focus query params.");

const reservationsPanel = read("src/components/admin/AdminReservationsPanel.tsx");
assert.match(reservationsPanel, /reservationId/, "Reservations panel should understand reservationId focus query params.");
assert.match(reservationsPanel, /newReservation/, "Reservations panel should understand newReservation focus query params.");
assert.match(reservationsPanel, /highlightedReservationId/, "Reservation tables should highlight focused reservations.");
assert.match(reservationsPanel, /isFieldOperator/, "Operational panel should have a field-operator read-only mode.");
assert.match(reservationsPanel, /showCost=\{!isFieldOperator\}/, "Field operators should not see operational billing cost details.");
assert.match(reservationsPanel, /panelAllowedInWorkspace\(requestedPanel, workspace, isFieldOperator\)/, "Field operators should not be switched into hidden commercial panels.");

const operationalPage = read("src/app/admin/operational/page.tsx");
assert.match(operationalPage, /"dashboard\.operations\.view"/, "Operational page should allow dedicated operations-only accounts.");
assert.match(operationalPage, /session\.role === "FIELD_OPERATOR"/, "Operational page should branch for field-operator data minimization.");
assert.match(operationalPage, /initialOfferRequests=\{\[\]\}/, "Operational page should not load public offer requests for the operational workspace.");

const coo = read("src/components/admin/CooCommandCenter.tsx");
assert.equal(coo.includes("Marcheaza rezolvat"), false, "COO conflict note-only resolve button should not be visible.");
assert.equal(coo.includes("Aproba exceptie"), false, "COO conflict note-only exception button should not be visible.");
assert.match(coo, /Rezolvare manuala necesara/, "COO conflict menu should explain that manual correction is needed.");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "admin route helper URLs",
    "dashboard action components avoid hardcoded /admin/locatii#rezervari",
    "AdminHeader active state and public label",
    "Backup JSON label removed",
    "location/reservation query focus source checks",
    "COO note-only conflict buttons hidden"
  ]
}, null, 2));

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}
