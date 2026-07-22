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
  "src/components/admin/CrmWorkspaceV4.tsx"
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
assert.match(header, /<FocusLogo href="\/admin\/dashboard" prefetch=\{false\} \/>/, "Admin logo should not prefetch the dashboard shell.");
assert.match(header, /prefetch=\{false\}/, "Admin navigation links should disable automatic Next.js prefetching.");
assert.match(header, /label="Comercial"/, "AdminHeader should group sales workflows under Comercial.");
assert(
  header.indexOf('label="Comercial"') < header.indexOf('href="/admin/selectie-locatii"'),
  "Selector oferta should live inside the Comercial workflow menu."
);
assert.match(header, /label="Financiar"/, "AdminHeader should group finance workflows under Financiar.");
assert.match(header, /label="Facturi clienți"/, "Finance navigation should use the customer invoice workflow label.");
assert.equal(header.includes("SmartBill / rapoarte"), false, "Legacy SmartBill reports should not be a COO/admin navigation entry.");
assert(
  header.indexOf('label="Financiar"') < header.indexOf('href="/admin/furnizori"'),
  "Furnizori should live inside the Financiar workflow menu."
);
assert.match(header, /label="Setari"/, "AdminHeader should expose Setari instead of a vague Admin button.");
assert.match(header, /href="\/admin\/operational"/, "AdminHeader should expose a dedicated Operational workspace.");
assert.match(header, /session\.role === "FIELD_OPERATOR"/, "AdminHeader should treat field operators as a restricted navigation role.");
assert.match(header, /!\s*isFieldOperator \? <NotificationBell \/> : null/, "Field operators should not load generic admin notifications.");
assert.match(header, /"dashboard\.operations\.view"/, "Operational navigation should include the dedicated operations dashboard permission.");
assert.equal(header.includes('<AdminNavLink href="/admin/campanii"'), false, "Campanii should not be a misleading top-level nav item.");
assert.equal(header.includes('<AdminNavLink href="/admin/furnizori"'), false, "Furnizori should not clutter top-level navigation.");
assert.equal(header.includes("/api/admin/availability/excel"), false, "Availability export should not be exposed from the global admin header.");

const adminDashboard = read("src/components/admin/AdminDashboard.tsx");
assert.equal(adminDashboard.includes("Backup JSON"), false, "Developer-ish Backup JSON label should not be visible.");
assert.match(adminDashboard, /locationId/, "Admin locations page should understand locationId focus query params.");

const gpsAudit = read("src/components/admin/GpsAuditDashboard.tsx");
assert.match(gpsAudit, /aria-label="Filtreaza locatiile dupa statusul GPS"/, "GPS status filter should have an accessible label.");

const userManagement = read("src/components/admin/UserManagement.tsx");
assert.match(userManagement, /aria-label=\{`Rol pentru \$\{user\.name\}`\}/, "User role selectors should identify the affected user.");
assert.match(userManagement, /focus-input w-\[190px\] min-w-\[190px\]/, "User role labels should remain readable in the account table.");

const reservationsPanel = read("src/components/admin/AdminReservationsPanel.tsx");
assert.match(reservationsPanel, /reservationId/, "Reservations panel should understand reservationId focus query params.");
assert.match(reservationsPanel, /newReservation/, "Reservations panel should understand newReservation focus query params.");
assert.match(reservationsPanel, /highlightedReservationId/, "Reservation tables should highlight focused reservations.");
assert.match(reservationsPanel, /isFieldOperator/, "Operational panel should have a field-operator read-only mode.");
assert.match(reservationsPanel, /shouldLoadReservationOptions = !isOperationalWorkspace && canEditReservations/, "Operational/read-only pages should not fetch reservation form clients/sellers.");
assert.match(reservationsPanel, /showCost=\{!isFieldOperator\}/, "Field operators should not see operational billing cost details.");
assert.match(reservationsPanel, /panelAllowedInWorkspace\(requestedPanel, workspace, isFieldOperator\)/, "Field operators should not be switched into hidden commercial panels.");

const operationalPage = read("src/app/admin/operational/page.tsx");
assert.match(operationalPage, /"dashboard\.operations\.view"/, "Operational page should allow dedicated operations-only accounts.");
assert.equal(operationalPage.includes("listAdminLocations"), false, "Operational page should not load the full inventory list.");
assert.equal(operationalPage.includes("listReservations"), false, "Operational page should not load the full reservations list.");
assert.match(operationalPage, /initialReservations=\{operationReservations\}/, "Operational page should use the focused operational reservation set.");
assert.match(operationalPage, /initialOfferRequests=\{\[\]\}/, "Operational page should not load public offer requests for the operational workspace.");

for (const file of [
  "src/components/admin/AdminDashboard.tsx",
  "src/components/admin/RoleDashboard.tsx",
  "src/components/admin/CooCommandCenter.tsx",
  "src/components/admin/DashboardHoldActions.tsx"
]) {
  const source = read(file);
  assert.equal(
    /<Link(?![^>]*prefetch=)/s.test(source),
    false,
    `${file} should disable automatic prefetch for admin dashboard links.`
  );
}

const clientsPage = read("src/app/admin/clienti/page.tsx");
assert.match(clientsPage, /hasAnyPermission\(session\.role, \["clients\.view", "clients\.view\.own", "campaigns\.view", "campaigns\.view\.own", "finance\.view"\]\)/, "Clients page should guard direct access by commercial/finance permissions.");

const campaignsPage = read("src/app/admin/campanii/page.tsx");
assert.match(campaignsPage, /hasAnyPermission\(session\.role, \["campaigns\.view", "campaigns\.view\.own", "clients\.view", "clients\.view\.own", "finance\.view"\]\)/, "Campaigns page should guard direct access by commercial/finance permissions.");

const clientCampaignsApi = read("src/app/api/admin/client-campaigns/route.ts");
assert.match(clientCampaignsApi, /requireAnyPermission\(request, \["clients\.view", "clients\.view\.own", "campaigns\.view", "campaigns\.view\.own", "finance\.view"\]\)/, "Client/campaign API should not be available to generic operations-only accounts.");

const auth = read("src/lib/auth.ts");
assert.equal(auth.includes('"dashboard.operations.view",\n    "dashboard.agent.view"'), false, "Operations-only permission should not satisfy generic admin API access.");

const coo = read("src/components/admin/CooCommandCenter.tsx");
assert.equal(coo.includes("Marcheaza rezolvat"), false, "COO conflict note-only resolve button should not be visible.");
assert.equal(coo.includes("Aproba exceptie"), false, "COO conflict note-only exception button should not be visible.");
assert.equal(coo.includes('fetch("/api/admin/command-center"'), false, "COO dashboard should be read-only and delegate actions to domain workspaces.");
assert.match(coo, /href="\/admin\/operational"/, "COO operational summaries should link to the dedicated workspace.");

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
