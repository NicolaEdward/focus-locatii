const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

main();

function main() {
  adminDashboardHasDetailAction();
  timelineRouteIsReadOnlyAndUsesLocationId();
  timelineRouteFiltersAndSortsFuturePeriods();
  timelineRouteGatesPrivateReservationFields();
  drawerHasExpectedSectionsAndQuickActions();
  presentationBlockAvoidsPrivateFields();

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "location drawer button exists",
      "future availability API is read-only and uses location id",
      "timeline excludes inactive statuses and sorts active periods first",
      "reservation/client/seller details are role gated",
      "drawer includes presentation, timeline and quick actions",
      "public-style presentation block avoids private fields"
    ]
  }, null, 2));
}

function adminDashboardHasDetailAction() {
  const dashboard = read("src", "components", "admin", "AdminDashboard.tsx");
  const inventory = read("src", "components", "admin", "inventory", "InventoryList.tsx");
  assert(dashboard.includes("LocationDetailDrawer"), "AdminDashboard should render the location detail drawer");
  assert(dashboard.includes("setDetailLocation(location)"), "inventory selection should open the location drawer");
  assert(inventory.includes("> Detalii</button>"), "location row should expose a clear details action");
}

function timelineRouteIsReadOnlyAndUsesLocationId() {
  const route = read("src", "app", "api", "admin", "locations", "[id]", "availability-timeline", "route.ts");
  assert(route.includes('requirePermission(request, "inventory.view")'), "timeline route should require admin inventory access");
  assert(route.includes("where: { id }"), "location lookup should use the location id");
  assert(route.includes("locationId: id"), "reservation lookup should use locationId from route param");
  assert(!/prisma\.\w+\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(route), "timeline route must be read-only");
}

function timelineRouteFiltersAndSortsFuturePeriods() {
  const route = read("src", "app", "api", "admin", "locations", "[id]", "availability-timeline", "route.ts");
  assert(route.includes("effectiveBlockingReservationWhere(now)"), "timeline should include only effective commercial blockers");
  assert(route.includes("decideAvailability({"), "timeline summary should use the canonical availability decision");
  assert(route.includes("periodEnd: { gte: today }"), "timeline should include active/future periods and skip old ended rows");
  assert(!route.includes('"CANCELLED"'), "timeline should not include cancelled rows");
  assert(!route.includes('"LOST"'), "timeline should not include lost rows");
  assert(!route.includes('"ARCHIVED"'), "timeline should not include archived rows");
  assert(route.includes("if (left.isActiveToday !== right.isActiveToday) return left.isActiveToday ? -1 : 1;"), "active today should sort before upcoming rows");
  assert(route.includes("conflictReservationIds"), "timeline should expose conflict indicators");
}

function timelineRouteGatesPrivateReservationFields() {
  const route = read("src", "app", "api", "admin", "locations", "[id]", "availability-timeline", "route.ts");
  assert(route.includes("canViewReservationDetails(session, reservation)"), "reservation details should be checked per row");
  assert(route.includes('["SALES_DIRECTOR", "COO", "SUPER_ADMIN"].includes(session.role)'), "director/COO/admin should see full reservation context");
  assert(route.includes("reservation.sellerUserId === session.id"), "sales agents should only see owned reservation context");
  assert(route.includes("clientName: canViewDetails ?"), "client name should be nulled when the role cannot view details");
  assert(route.includes("sellerName: canViewDetails ?"), "seller name should be nulled when the role cannot view details");
  assert(route.includes("contractNumber: canViewDetails ?"), "contract number should be nulled when the role cannot view details");
}

function drawerHasExpectedSectionsAndQuickActions() {
  const drawer = read("src", "components", "admin", "LocationDetailDrawer.tsx");
  for (const title of ["Prezentare", "Disponibilitate viitoare", "Actiuni rapide"]) {
    assert(drawer.includes(`Panel title="${title}"`), `drawer should include ${title}`);
  }
  assert(drawer.includes('Panel title="Date interne"'), "drawer should have role-gated internal details");
  assert(drawer.includes("Nu exista rezervari viitoare pentru aceasta locatie."), "drawer should show an empty future-availability state");
  assert(drawer.includes("adminNewReservationHref({ locationId: displayLocation.id })"), "new reservation quick action should include selected location id");
  assert(drawer.includes("adminReservationHref(period.id)"), "timeline rows should deep-link to the focused reservation");
  assert(drawer.includes("Copiaza link prezentare"), "drawer should support copying the public presentation link");
}

function presentationBlockAvoidsPrivateFields() {
  const drawer = read("src", "components", "admin", "LocationDetailDrawer.tsx");
  const presentation = blockFrom(drawer, 'Panel title="Prezentare"', 'Panel title="Date admin / comercial"');
  for (const privateField of ["latReal", "lngReal", "internalNotes", "monthlyCost", "costNotes", "blockedReason", "contractNumber", "sellerName"]) {
    assert(!presentation.includes(privateField), `${privateField} should not appear in public-style presentation`);
  }

  const route = read("src", "app", "api", "admin", "locations", "[id]", "availability-timeline", "route.ts");
  assert(route.includes("serializeLocation(location, { includeHiddenCommercials: false, includePrivateFields: false })"), "public-style location DTO should omit hidden commercial/private fields");
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
